import { useEffect, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import "@fontsource/roboto-mono/latin-400.css";
import "@fontsource/roboto-mono/latin-400-italic.css";
import "@fontsource/roboto-mono/latin-700.css";
import Icon from "../Icon.jsx";
import { parseTags, serializeTags, tagHref } from "../../lib/tags.js";
import { uploadFilename } from "../../lib/publish.js";
import { loadDraft, saveDraft, clearDraft } from "../../lib/editorDraft.js";
import { sandboxPreview } from "../../lib/sandboxPreview.js";
import SandboxModal from "./SandboxModal.jsx";
import SandboxExternalModal from "./SandboxExternalModal.jsx";
import { findSandboxBlocks, specToToolbar, DEFAULT_W, DEFAULT_H } from "../../lib/sandbox.js";
import { CAN_DELETE } from "../../lib/permissions.js";
import EntryDates from "../EntryDates.jsx";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { format } from "date-fns";

const localStamp = (d = new Date()) => format(d, "yyyy-MM-dd'T'HH:mm:ss.000'Z'");
const slugFromPath = (p) => p.replace(/^src\/content\/posts\//, "").replace(/\.md$/, "");

function exitHref({ wasDraft, savedPath, entryHref, isDev }) {
  if (wasDraft) return "/admin/drafts/";
  if (isDev && savedPath) return `/posts/${slugFromPath(savedPath)}/`;
  return entryHref;
}

const HEADER_OFFSET = 96; // reading line just below the sticky header

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
  ".cm-line::selection, .cm-line ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
  },
});

export default function EntryEditor({ markdown: md = "", title: initialTitle = "", date = null, updated = null, path = null, isNew = false, tags: initialTags = "", draft: initialDraft = false }) {
  const editorId = path || "new"; // the slot is keyed to this editor; opening another takes it over
  const [restored] = useState(() => loadDraft(editorId));
  const [title, setTitle] = useState(restored?.title ?? initialTitle);
  const [draft, setDraft] = useState(restored?.draft ?? initialDraft);
  const [tags, setTags] = useState(() => parseTags(restored?.tags ?? initialTags));
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef(null);
  const [entryDate, setEntryDate] = useState(restored?.entryDate ?? date);
  const [pickingDate, setPickingDate] = useState(false);
  const datePickerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const [fabBottom, setFabBottom] = useState(null); // px; lifts above the mobile keyboard
  const [sandboxEdit, setSandboxEdit] = useState(null); // { mode, from, to, initial, siblings }
  const hostRef = useRef(null);
  const cmRef = useRef(null);
  const fileRef = useRef(null);
  const uploadsRef = useRef(new Map());
  const slug = path ? slugFromPath(path) : null;
  const entryHref = slug ? `/posts/${slug}/` : "/";

  useEffect(() => {
    if (!isNew || restored?.entryDate) return;
    const d = new URLSearchParams(window.location.search).get("date");
    setEntryDate(d ? `${d}T12:00:00.000Z` : localStamp());
  }, []);

  useEffect(() => {
    if (!pickingDate) return;
    const onDown = (e) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) setPickingDate(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setPickingDate(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [pickingDate]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const isDesktop = () => window.matchMedia("(min-width: 56.01rem)").matches;

  // Pin the floating buttons in desktop only, to keep them in view as the user types
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setFabBottom(!isDesktop() && inset > 1 ? inset : null);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => { vv.removeEventListener("resize", onResize); vv.removeEventListener("scroll", onResize); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.kind === "err" ? 7000 : 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Persist editor progress so an accidental reload/close doesn't lose it
  const clearedRef = useRef(false); // stops a flush from resurrecting a discarded/saved draft
  const persist = () => {
    if (clearedRef.current) return;
    const body = cmRef.current ? cmRef.current.state.doc.toString() : md;
    if (isNew && !title.trim() && !body.trim() && !tags.length) {
      clearDraft(); // an empty new entry leaves nothing to keep
      return;
    }
    saveDraft(editorId, { title, body, tags: serializeTags(tags), draft, entryDate });
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const saveTimer = useRef(null);
  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(persist, 600);
  };
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;
  const clearProgress = () => { clearedRef.current = true; clearTimeout(saveTimer.current); clearDraft(); };

  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    scheduleSave();
  }, [title, tags, draft, entryDate]);

  // Flush synchronously on unload — the debounce timer won't survive a reload
  useEffect(() => {
    const flush = () => persistRef.current();
    window.addEventListener("pagehide", flush);
    return () => { clearTimeout(saveTimer.current); window.removeEventListener("pagehide", flush); };
  }, []);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: restored?.body ?? md,
        extensions: [
          history(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(highlight),
          theme,
          sandboxPreview({
            onEdit: (b) => onEditRef.current?.(b),
            onCreate: (kind, p) => onCreateRef.current?.(kind, p),
          }),

          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            scheduleSaveRef.current();
            const c = u.view.coordsAtPos(u.view.state.selection.main.head);
            if (!c) return;
            const overflow = c.bottom - (window.innerHeight - HEADER_OFFSET);
            if (overflow > 0) window.scrollBy(0, overflow);
          }),
        ],
      }),
      parent: hostRef.current,
    });
    cmRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      cmRef.current = null;
    };
  }, []);

  // Opening a post claims the slot with its text right away; nothing to claim for an empty new entry
  useEffect(() => {
    if (!restored && !isNew) persist();
  }, []);

  function cancel() {
    const body = cmRef.current?.state.doc.toString() ?? md;

    let dirty;
    if (isNew) {
      dirty = Boolean(title.trim() || body.trim());
    } else {
      const tagsChanged = serializeTags(tags) !== serializeTags(parseTags(initialTags));
      const dateChanged = Boolean(entryDate && date && entryDate.slice(0, 10) !== date.slice(0, 10));

      dirty =
        body !== md ||
        title !== initialTitle ||
        draft !== initialDraft ||
        tagsChanged ||
        dateChanged;
    }

    const prompt = isNew ? "Discard this new entry?" : "Discard your changes?";
    if (dirty && !window.confirm(prompt)) return;
    clearProgress();
    window.location.href = exitHref({ wasDraft: !isNew && initialDraft, savedPath: null, entryHref, isDev: import.meta.env.DEV });
  }

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
    else if (e.key === ",") { e.preventDefault(); commitTagDraft(); }
    else if (e.key === "Escape") { e.preventDefault(); setTagDraft(""); setAddingTag(false); }
    else if (e.key === "Backspace" && !tagDraft && tags.length) {
      e.preventDefault();
      setTags((cur) => cur.slice(0, -1));
    }
  }

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  function insertAtCursor(text) {
    const view = cmRef.current;
    if (!view) return;
    const pos = view.state.selection.main.head;
    view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
    view.focus();
  }

  // Sandbox figures are edited in a modal, not inline. These bridge the CodeMirror widget
  // buttons (see sandboxPreview.js) to the React modal; refs keep the callbacks current.
  const onEditRef = useRef();
  const onCreateRef = useRef();
  onEditRef.current = (block) => {
    const siblings = findSandboxBlocks(cmRef.current?.state.doc.toString() ?? "");
    const base = { from: block.from, to: block.to, siblings };
    if (block.snippet) {
      setSandboxEdit({ ...base, modal: "source", initial: { srcLang: "js", name: block.summary, id: block.id, code: block.code } });
    } else if (block.vueLib) {
      setSandboxEdit({ ...base, modal: "source", initial: { srcLang: "vue", name: block.componentName, id: block.id, code: block.code } });
    } else if (block.external) {
      setSandboxEdit({ ...base, modal: "external", initial: { label: block.summary, id: block.id, code: block.code } });
    } else {
      setSandboxEdit({ ...base, modal: "figure", initial: { ...specToToolbar(block), code: block.code } });
    }
  };
  onCreateRef.current = (kind, pos) => {
    const siblings = findSandboxBlocks(cmRef.current?.state.doc.toString() ?? "");
    const base = { from: pos, to: pos, siblings };
    if (kind === "external") {
      setSandboxEdit({ ...base, modal: "external", initial: { label: "", id: "", code: "" } });
    } else if (kind === "source") {
      setSandboxEdit({ ...base, modal: "source", initial: { srcLang: "js", name: "", id: "", code: "" } });
    } else {
      setSandboxEdit({ ...base, modal: "figure", initial: { type: "canvas", w: DEFAULT_W, h: DEFAULT_H, bg: "", showCode: false, auto: false, preview: false, id: "", code: "// your code" } });
    }
  };

  function saveSandbox(fence) {
    const view = cmRef.current;
    setSandboxEdit(null);
    if (!view || !sandboxEdit) return;
    const { from, to } = sandboxEdit;
    const isNewBlock = from === to; // a fresh insert has no range to replace
    let insert = fence;
    if (isNewBlock && from > 0 && view.state.doc.sliceString(from - 1, from) !== "\n") insert = "\n" + insert;
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    view.focus();
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setToast(null);
    const filename = uploadFilename(file.name, file.type);
    if (!filename) {
      setToast({ kind: "err", msg: "Unsupported image type (png, jpg, gif, webp, avif)" });
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]); // strip data: prefix
        r.onerror = () => reject(new Error("Could not read file"));
        r.readAsDataURL(file);
      });
      uploadsRef.current.set(`public/uploads/${filename}`, data);
      insertAtCursor(`![](/uploads/${filename})`);
    } catch (err) {
      setToast({ kind: "err", msg: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body = cmRef.current ? cmRef.current.state.doc.toString() : md;
    const autoTitle = !title.trim();
    if (autoTitle && !body.trim()) {
      setToast({ kind: "err", msg: "Write something first." });
      return;
    }
    const tagsStr = serializeTags([...tags, ...tagDraft.split(",")]);
    setBusy(true);
    setToast(null);

    try {
      const dateChanged = path && entryDate && date && entryDate.slice(0, 10) !== date.slice(0, 10);
      const payload = path
        ? { path, title: title.trim(), markdown: body, updated: localStamp(), tags: tagsStr, draft, ...(dateChanged ? { date: entryDate } : {}) }
        : { title: title.trim(), markdown: body, tags: tagsStr, draft, ...(entryDate ? { date: entryDate } : {}) };
      payload.images = [...uploadsRef.current].map(([p, data]) => ({ path: p, data }));
      const res = await fetch("/admin/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
      clearProgress();

      const named = autoTitle && data.title ? ` as “${data.title}”` : "";
      const what = (path ? "Changes saved" : "Entry saved") + named;
      setToast({
        kind: "ok",
        msg: `${what} locally — commit and push to publish.`,
        url: data.commit || data.url,
      });

      const dest = exitHref({ wasDraft: !isNew && initialDraft, savedPath: data.path, entryHref, isDev: import.meta.env.DEV });
      setTimeout(() => { window.location.href = dest; }, 1400);
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
      const res = await fetch("/admin/api/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, title: title.trim(), date: entryDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      clearProgress();
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

  const backToTop = scrolled && (
    <button className="fab-btn" onClick={toTop} aria-label="Back to top" title="Back to top">
      <Icon name="chevronUp" size={19} />
    </button>
  );

  const topDivider = scrolled && <div className="fab-divider" aria-hidden="true" />;
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

  const fabStyle = fabBottom != null ? { bottom: `calc(1.25rem + ${fabBottom}px)` } : undefined;
  const dayPrefix = entryDate ? entryDate.slice(0, 10) : null;
  const selectedDay = dayPrefix ? new Date(`${dayPrefix}T00:00:00`) : undefined;
  const onPickDay = (day) => {
    if (!day) return; // clicking the selected day again clears it — keep the date

    setEntryDate(format(day, "yyyy-MM-dd'T'12:00:00.000'Z'"));
    setPickingDate(false);
  };

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
      <div className="entry-meta-block">
      <ul className="hashtags hashtags-edit" aria-label="Tags">
        {tags.map((tag) => (
          <li key={tag} className="hashtag-chip" title={tag}>
            <a className="hashtag" href={tagHref(tag)}>#{tag}</a>
            <button
              type="button"
              className="hashtag-x"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              <Icon name="close" size={11} />
            </button>
          </li>
        ))}
        {addingTag ? (
          <li>
            <input
              ref={tagInputRef}
              className="hashtag-input"
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
              className="hashtag-add"
              onClick={() => setAddingTag(true)}
              aria-label="Add tag"
              title="Add tag"
            >
              <Icon name="plus" size={12} />
              {tags.length === 0 && <span>Tag</span>}
            </button>
          </li>
        )}
      </ul>
        <div className="entry-meta-side">
          <div className="date-picker" ref={datePickerRef}>
            <EntryDates created={entryDate} updated={updated} onEditDate={() => setPickingDate((v) => !v)} />
            {pickingDate && (
              <div className="date-popover" role="dialog" aria-label="Pick the creation date">
                <DayPicker
                  mode="single"
                  required={false}
                  selected={selectedDay}
                  defaultMonth={selectedDay}
                  onSelect={onPickDay}
                  showOutsideDays
                />
              </div>
            )}
          </div>
          <button
            type="button"
            className={`draft-toggle ${draft ? "is-draft" : "is-published"}`}
            onClick={() => setDraft((d) => !d)}
            role="switch"
            aria-checked={!draft}
            aria-label="Published or draft"
            title={draft ? "Draft — unlisted until published" : "Publishing this entry"}
          >
            <span className="draft-toggle-track">
              <span className="draft-toggle-text">
                {draft ? "Draft" : isNew ? "Publish now" : "Published"}
              </span>
              <span className="draft-toggle-thumb" aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>

      <div className="cm-host" ref={hostRef}></div>

      {sandboxEdit && (sandboxEdit.modal === "external" ? (
        <SandboxExternalModal
          key={`ext-${sandboxEdit.from}`}
          initial={sandboxEdit.initial}
          onSave={saveSandbox}
          onCancel={() => setSandboxEdit(null)}
        />
      ) : (
        <SandboxModal
          key={`${sandboxEdit.modal}-${sandboxEdit.from}`}
          kind={sandboxEdit.modal}
          initial={sandboxEdit.initial}
          siblings={sandboxEdit.siblings}
          onSave={saveSandbox}
          onCancel={() => setSandboxEdit(null)}
        />
      ))}

      {toastEl}
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
