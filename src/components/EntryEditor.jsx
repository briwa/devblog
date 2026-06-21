import { useEffect, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
// Self-hosted Roboto Mono for the source editor — a modern monospace that keeps
// the code-like, markdown-denoting feel. Bundled with the editor (loads only
// when this island hydrates); CJK titles fall back to the system mono below.
import "@fontsource/roboto-mono/latin-400.css";
import "@fontsource/roboto-mono/latin-400-italic.css";
import "@fontsource/roboto-mono/latin-700.css";
import Icon from "./Icon.jsx";
import { parseTags, serializeTags, tagClass, tagHref } from "../lib/tags.js";
import { sandboxPreview } from "../lib/sandboxPreview.js";
import { CAN_CREATE, CAN_EDIT, CAN_DELETE } from "../lib/capabilities.js";
import EntryDates from "./EntryDates.jsx";

// The site renders every date in UTC, but an entry belongs to the author's
// *local* day. So we stamp timestamps with the local wall-clock wearing a `Z`:
// an edit made at 03:36 local reads back as that day under UTC display, not the
// prior UTC day. Used for a new entry's creation day (which becomes its filename)
// and for `updated` on edits. Computed here (not on the server, which runs in UTC).
const localStamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000Z`;
};

// When toggling between the rendered prose and the monospace source editor the
// fonts (and thus line heights / wrapping) differ wildly, so a pixel-for-pixel
// scroll restore lands on the wrong paragraph. Instead we anchor on the
// paragraph itself: `normKey` reduces a block of text to lowercase alphanumerics
// only — stripping markdown syntax (>, **, -, 1.) and smart quotes — so the same
// paragraph compares equal whether it's rendered HTML or raw markdown source.
const HEADER_OFFSET = 96; // reading line just below the sticky header
const normKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
// Two keys name the same paragraph when they share a long-enough leading run.
const samePara = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 10;
};

// Colors reference our CSS variables, so the editor follows the site theme with
// no JS — light/dark just works.
const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "'Roboto Mono', ui-monospace, 'SF Mono', monospace" },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--muted)" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    fontFamily: "'Roboto Mono', ui-monospace, 'SF Mono', monospace",
    fontSize: "0.9rem",
    lineHeight: "1.75",
    padding: 0,
    caretColor: "var(--ink)",
  },
  ".cm-line": { padding: 0 },
  "::selection": { backgroundColor: "var(--hover-bg)" },
});

// A lightweight markdown SOURCE editor (CodeMirror). The public view renders
// the markdown to HTML (Astro/Shiki); editing shows the raw source here.
export default function EntryEditor({ markdown: md = "", title: initialTitle = "", date = null, updated = null, path = null, isNew = false, tags: initialTags = "" }) {
  const [editing, setEditing] = useState(isNew && CAN_CREATE);
  const [title, setTitle] = useState(initialTitle);
  // Tags (frontmatter `tags`) — edited as chips here, persisted as a
  // comma-separated string on Save. Normalized through parseTags so casing,
  // spacing and de-duping match how they render everywhere else.
  const [tags, setTags] = useState(() => parseTags(initialTags));
  const [addingTag, setAddingTag] = useState(false); // the inline add-tag input is open
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef(null);
  const [entryDate, setEntryDate] = useState(date); // edit: original; new: optional ?date
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [scrolled, setScrolled] = useState(false); // reveals the back-to-top button
  const [fabBottom, setFabBottom] = useState(null); // px; lifts above the keyboard (mobile)
  const hostRef = useRef(null);
  const cmRef = useRef(null);
  const fileRef = useRef(null);
  const scrollRef = useRef(null); // paragraph anchor captured across a view<->edit toggle

  const setEditParam = (on) => {
    const url = new URL(window.location.href);
    if (on) url.searchParams.set("edit", "");
    else url.searchParams.delete("edit");
    window.history.replaceState({}, "", url);
  };

  // --- Scroll anchoring across the view<->edit toggle ----------------------
  // Capture the paragraph at the top of the reading area (and where it sits in
  // the viewport) so we can put it back in the same place after the swap.
  // The block elements we anchor on. Deeply nested markdown (e.g. a long list)
  // renders as one big top-level node, so we match these leaf blocks directly —
  // each lines up with a single source line.
  const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre";
  function captureView() {
    const prose = document.querySelector("#entry-view .prose");
    if (!prose) return null;
    // The deepest block sitting on the reading line — elementsFromPoint returns
    // innermost first, so a paragraph wins over its wrapping list item.
    const x = Math.round(prose.getBoundingClientRect().left + prose.clientWidth / 2);
    for (const el of document.elementsFromPoint(x, HEADER_OFFSET)) {
      if (el.matches(BLOCK_SEL) && prose.contains(el) && normKey(el.textContent)) {
        return { key: normKey(el.textContent), top: el.getBoundingClientRect().top };
      }
    }
    return null;
  }
  function captureEditor() {
    const view = cmRef.current;
    if (!view) return null;
    const rect = view.dom.getBoundingClientRect();
    let pos = view.posAtCoords({ x: rect.left + 8, y: Math.max(HEADER_OFFSET, rect.top + 4) });
    if (pos == null) pos = 0;
    const line = view.state.doc.lineAt(pos);
    const c = view.coordsAtPos(line.from);
    return { key: normKey(line.text), top: c ? c.top : HEADER_OFFSET };
  }

  // Re-place the captured paragraph at its former viewport offset. We read the
  // target's live position (so it works even after CodeMirror auto-scrolls on
  // focus) and shift by the delta.
  function restoreToEditor(anchor) {
    const view = cmRef.current;
    if (!view || !anchor) return;
    const doc = view.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      if (samePara(normKey(doc.line(i).text), anchor.key)) {
        const c = view.coordsAtPos(doc.line(i).from);
        if (c) window.scrollBy(0, c.top - anchor.top);
        return;
      }
    }
  }
  function restoreToView(anchor) {
    const prose = document.querySelector("#entry-view .prose");
    if (!prose || !anchor) return;
    for (const el of prose.querySelectorAll(BLOCK_SEL)) {
      if (samePara(normKey(el.textContent), anchor.key)) {
        window.scrollBy(0, el.getBoundingClientRect().top - anchor.top);
        return;
      }
    }
  }

  function enterEdit() {
    scrollRef.current = captureView(); // realign this paragraph once the editor mounts
    setToast(null);
    setEditing(true);
    setEditParam(true);
  }
  function leaveEdit() {
    scrollRef.current = captureEditor(); // realign once the static view returns
    setEditing(false);
    setEditParam(false);
  }

  // New entries can be dated via ?date=YYYY-MM-DD (from the heatmap); otherwise
  // they default to today, so the date is set and shown right away. Existing
  // entries can be deep-linked straight into edit mode with ?edit.
  useEffect(() => {
    if (isNew) {
      const d = new URLSearchParams(window.location.search).get("date");
      setEntryDate(d ? `${d}T12:00:00.000Z` : localStamp());
      return;
    }
    // Honour the ?edit deep-link only when editing is permitted.
    if (CAN_EDIT && new URLSearchParams(window.location.search).has("edit")) setEditing(true);
  }, []);

  // Show the static view when not editing, hide it while editing.
  useEffect(() => {
    const view = document.getElementById("entry-view");
    if (view) view.style.display = editing ? "none" : "";
  }, [editing]);

  // The floating toolbar's back-to-top button only appears once you've scrolled.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // The toolbar stays fixed in place (CSS): pinned beside the column on desktop,
  // docked bottom-right on mobile — no scroll tracking, so it never drifts. The
  // one adjustment is lifting it above the on-screen keyboard while editing so
  // its actions stay reachable.
  const isDesktop = () => window.matchMedia("(min-width: 56.01rem)").matches;
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // How much of the layout viewport the keyboard hides at the bottom.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setFabBottom(!isDesktop() && inset > 1 ? inset : null);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => { vv.removeEventListener("resize", onResize); vv.removeEventListener("scroll", onResize); };
  }, []);

  // Auto-dismiss the toast; errors linger a little longer than confirmations.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.kind === "err" ? 7000 : 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Create / tear down the CodeMirror instance with edit mode.
  useEffect(() => {
    if (!editing || !hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: md,
        extensions: [
          history(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          theme,
          // Recognize ```js canvas|svg|d3 blocks and give each an inline
          // Show preview / Show code toggle (src/lib/sandboxPreview.js).
          sandboxPreview(),
        ],
      }),
      parent: hostRef.current,
    });
    cmRef.current = view;
    // If we arrived from a scroll position, drop the caret on that same
    // paragraph before focusing — otherwise focus (and, on mobile, the keyboard
    // re-scrolling the caret into view) yanks the page to the document's top.
    const anchor = scrollRef.current;
    if (anchor) {
      const d = view.state.doc;
      for (let i = 1; i <= d.lines; i++) {
        if (samePara(normKey(d.line(i).text), anchor.key)) {
          view.dispatch({ selection: { anchor: d.line(i).from } });
          break;
        }
      }
    }
    view.focus();
    return () => {
      view.destroy();
      cmRef.current = null;
    };
  }, [editing]);

  // Toggling edit mode swaps the rendered prose for the source editor (or back).
  // Once layout has settled — after CodeMirror has mounted and grabbed focus —
  // realign the anchored paragraph. Only runs when a toggle was user-initiated
  // (scrollRef set in enter/leaveEdit), not on first render.
  useEffect(() => {
    const anchor = scrollRef.current;
    if (!anchor) return;
    scrollRef.current = null;
    requestAnimationFrame(() => (editing ? restoreToEditor(anchor) : restoreToView(anchor)));
  }, [editing]);

  function cancel() {
    // A new entry has no view to fall back to — head back to the entry view,
    // confirming first if anything's been written so it isn't lost by accident.
    if (isNew) {
      const dirty = title.trim() || cmRef.current?.state.doc.toString().trim();
      if (dirty && !window.confirm("Discard this new entry?")) return;
      window.location.href = "/";
      return;
    }
    setTitle(initialTitle);
    setTags(parseTags(initialTags));
    setAddingTag(false);
    setTagDraft("");
    setToast(null);
    leaveEdit();
  }

  // --- Tag editing ---------------------------------------------------------
  // Commit the draft: a comma lets several be added at once. Merge through
  // parseTags so the new ones are normalized and de-duped against the existing
  // set, then keep the input open (cleared) so adding a run of tags is quick.
  function commitTagDraft() {
    const merged = parseTags([...tags, ...tagDraft.split(",")]);
    setTags(merged);
    setTagDraft("");
  }
  function removeTag(tag) {
    setTags((cur) => cur.filter((t) => t !== tag));
  }
  function onTagKeyDown(e) {
    if (e.key === "Enter") { e.preventDefault(); commitTagDraft(); }
    // Comma is a separator, not a literal — fold it into a commit too.
    else if (e.key === ",") { e.preventDefault(); commitTagDraft(); }
    else if (e.key === "Escape") { e.preventDefault(); setTagDraft(""); setAddingTag(false); }
    // Backspace on an empty input nibbles the last chip — a familiar tag-input feel.
    else if (e.key === "Backspace" && !tagDraft && tags.length) {
      e.preventDefault();
      setTags((cur) => cur.slice(0, -1));
    }
  }

  // Focus the add-tag input the moment it opens.
  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  // Insert markdown at the cursor (used by image upload).
  function insertAtCursor(text) {
    const view = cmRef.current;
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
    view.focus();
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    setToast(null);
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]); // strip data: prefix
        r.onerror = () => reject(new Error("Could not read file"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: file.name, type: file.type, data }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Upload failed (${res.status})`);
      insertAtCursor(`![](${d.url})`);
    } catch (err) {
      setToast({ kind: "err", msg: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body = cmRef.current ? cmRef.current.state.doc.toString() : md;
    // Title is optional: left blank, it's generated on publish from the first
    // paragraph (a local heuristic — fallbackTitle in src/lib/publish.js). But an
    // empty entry has nothing to title, so still require *some* content.
    const autoTitle = !title.trim();
    if (autoTitle && !body.trim()) {
      setToast({ kind: "err", msg: "Write something first." });
      return;
    }
    // Fold any half-typed tag into the set before saving, so a tag left in the
    // input (never Enter'd) isn't silently dropped.
    const tagsStr = serializeTags([...tags, ...tagDraft.split(",")]);
    setBusy(true);
    setToast(null);
    try {
      // Editing keeps the original file (path), so it needs no date — the
      // filename already holds the creation day. New entries send their local
      // day so the file is created under the author's day, not the server's UTC.
      const payload = path
        ? { path, title: title.trim(), markdown: body, updated: localStamp(), tags: tagsStr }
        : { title: title.trim(), markdown: body, tags: tagsStr, ...(entryDate ? { date: entryDate } : {}) };
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      // When the title was left blank, the server titled it — show what it chose.
      const named = autoTitle && data.title ? ` as “${data.title}”` : "";
      const what = (path ? "Changes saved" : "Entry saved") + named;
      setToast({
        kind: "ok",
        msg: `${what} locally — commit and push to publish.`,
        url: data.commit || data.url,
      });
      if (path) {
        leaveEdit(); // editing an existing entry stays on its page
        setBusy(false);
      } else {
        // A brand-new entry heads back to the main page once the toast has shown;
        // keep `busy` set so the form can't be re-submitted while we navigate.
        setTimeout(() => { window.location.href = "/"; }, 1400);
      }
    } catch (e) {
      setToast({ kind: "err", msg: e.message });
      setBusy(false);
    }
  }

  async function del() {
    if (!path) return;
    if (!window.confirm("Delete this entry? This can’t be undone.")) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, title: title.trim(), date: entryDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      // Show the confirmation briefly, then leave — the entry is gone.
      setToast({
        kind: "ok",
        msg: "Entry deleted locally — commit and push to apply.",
      });
      setTimeout(() => { window.location.href = "/"; }, 1400);
    } catch (e) {
      setToast({ kind: "err", msg: e.message });
      setBusy(false);
    }
  }

  // The back-to-top button leads the floating toolbar in both modes; it only
  // shows once scrolled. The divider that separates it from the action buttons
  // therefore travels with the actions (rendered only when scrolled), so it's
  // never left floating when back-to-top is absent — or absent entirely in a
  // read-only build, whose view-mode toolbar has no action button after it.
  const backToTop = scrolled && (
    <button className="fab-btn" onClick={toTop} aria-label="Back to top" title="Back to top">
      <Icon name="chevronUp" size={19} />
    </button>
  );
  const topDivider = scrolled && <div className="fab-divider" aria-hidden="true" />;

  // Floating confirmation/error toast — rendered in both view and edit modes.
  const toastEl = toast && (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      <span className="toast-msg">{toast.msg}</span>
      {toast.url && (
        <a className="toast-link" href={toast.url} target="_blank" rel="noreferrer">View commit →</a>
      )}
      <button className="toast-x" onClick={() => setToast(null)} aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  );

  // Lift the docked toolbar above the on-screen keyboard on mobile; otherwise it
  // rests at its CSS position.
  const fabStyle = fabBottom != null ? { bottom: `calc(1.25rem + ${fabBottom}px)` } : undefined;

  // View mode: the static SSR entry is shown; we only float the edit affordance
  // alongside it, so the control lives in the same place as the editing actions.
  if (!editing) {
    // Render the toolbar only when there's something in it — the edit/new actions
    // when permitted, or just back-to-top once scrolled — never an empty bar.
    const showFab = CAN_EDIT || CAN_CREATE || scrolled;
    return (
      <>
        {showFab && (
          <div className="editor-fab" role="toolbar" aria-label="Entry actions" style={fabStyle}>
            {backToTop}
            {(CAN_EDIT || CAN_CREATE) && (
              <>
                {/* Divider only when back-to-top precedes the action buttons. */}
                {topDivider}
                {CAN_EDIT && (
                  <button className="fab-btn" onClick={enterEdit} aria-label="Edit entry" title="Edit entry">
                    <Icon name="pencil" size={18} />
                  </button>
                )}
                {/* New entry pre-dated to THIS entry's day (the filename's
                    YYYY-MM-DD prefix, carried in `date`) — not today. The home
                    heatmap opens the existing entry when you click a day that
                    already has one, so this is the only way to add a *second*
                    entry for that day. Falls back to today's date if `date` is
                    somehow absent. Accent-filled to match the home + button;
                    separated from the pencil by its own divider. */}
                {CAN_EDIT && CAN_CREATE && <div className="fab-divider" aria-hidden="true" />}
                {CAN_CREATE && (
                  <a
                    className="fab-btn fab-new"
                    href={date ? `/posts/new?date=${date.slice(0, 10)}` : "/posts/new/"}
                    aria-label="New entry for this day"
                    title="New entry for this day"
                  >
                    <Icon name="plus" size={18} />
                  </a>
                )}
              </>
            )}
          </div>
        )}
        {toastEl}
      </>
    );
  }

  return (
    <div className="entry">
      <div className="entry-bar">
        <input
          className="entry-title-input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      {/* One meta row (mirrors the read view): the tag editor on the left, dates
          on the right. Tag editor — chips with a remove (×), plus an inline add
          field behind a + button; saved into the `tags` frontmatter on Save. */}
      <div className="entry-meta-block">
      <ul className="entry-tags entry-tags-edit" aria-label="Tags">
        {tags.map((tag) => (
          <li key={tag} className={tagClass(tag)} title={tag}>
            {/* The label links to the tag's filtered home view (like the chips
                everywhere else); only the × removes it. */}
            <a className="tag-label" href={tagHref(tag)}>{tag}</a>
            <button
              type="button"
              className="tag-x"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              <Icon name="close" size={11} />
            </button>
          </li>
        ))}
        {addingTag ? (
          <li className="tag-add-field">
            <input
              ref={tagInputRef}
              className="tag-input"
              placeholder="tag…"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={onTagKeyDown}
              onBlur={() => { commitTagDraft(); setAddingTag(false); }}
            />
          </li>
        ) : (
          <li>
            <button
              type="button"
              className="tag-add"
              onClick={() => setAddingTag(true)}
              aria-label="Add tag"
              title="Add tag"
            >
              <Icon name="plus" size={13} />
              {tags.length === 0 && <span className="tag-add-label">Tag</span>}
            </button>
          </li>
        )}
      </ul>
        {/* Dates (non-editable), pushed to the right of the row — same component
            and "show updated?" rule as the read view. */}
        <EntryDates created={entryDate} updated={updated} />
      </div>

      <div className="cm-host" ref={hostRef}></div>

      {toastEl}

      {/* Floating toolbar — fixed in place; lifts above the keyboard on mobile. */}
      <div className="editor-fab" role="toolbar" aria-label="Editor actions" style={fabStyle}>
        {backToTop}
        {topDivider}
        <button className="fab-btn save" onClick={save} disabled={busy} aria-label="Save" title="Save">
          <Icon name="check" size={19} />
        </button>
        <button className="fab-btn" onClick={cancel} disabled={busy} aria-label={isNew ? "Discard and go back" : "Cancel"} title={isNew ? "Discard and go back" : "Cancel"}>
          <Icon name="close" size={19} />
        </button>
        <button className="fab-btn" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Attach image" title="Attach image">
          <Icon name="paperclip" size={18} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
        {!isNew && CAN_DELETE && (
          <>
            <div className="fab-divider" aria-hidden="true" />
            <button className="fab-btn danger" onClick={del} disabled={busy} aria-label="Delete entry" title="Delete entry">
              <Icon name="trash" size={17} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
