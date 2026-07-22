import { useEffect, useRef, useState } from "react";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { syntaxHighlighting, codeFolding, foldGutter, foldKeymap, bracketMatching } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { vue } from "@codemirror/lang-vue";
import Icon from "../Icon.jsx";
import { codeServices } from "../../lib/editorSetup.js";
import { codeHighlightStyle } from "../../lib/codeHighlight.js";
import { loadSandboxDraft, saveSandboxDraft, clearSandboxDraft } from "../../lib/sandboxDraft.js";
import {
  SANDBOX_TYPES,
  buildSandboxFence,
  buildLibFence,
  buildSrcdoc,
  buildVueSrcdoc,
  sandboxPrelude,
  sandboxExternals,
  sandboxVueComponents,
} from "../../lib/sandbox.js";

const langCompartment = new Compartment();

// Synchronous language support so highlighting is never subject to a lazy-import race.
const langSupport = (name) => (name === "vue" ? vue() : javascript());

// Build the preview srcdoc for the figure under edit; control:true so it runs but stays pausable.
function buildPreview({ type, w, h, bg, id }, code, siblings) {
  if (type === "vue") {
    return buildVueSrcdoc({ w, h, bg }, code, {
      externals: sandboxExternals(siblings, id),
      components: sandboxVueComponents(siblings, id),
    });
  }
  const spec = { preset: type, w, h, bg, control: true, id };
  return buildSrcdoc(spec, code, sandboxPrelude(siblings, id), sandboxExternals(siblings, id));
}

export default function SandboxModal({ kind = "figure", initial, siblings = [], onSave, onCancel, draftKey }) {
  const isFigure = kind === "figure";
  // A crash-safe draft of unsaved edits (see sandboxDraft.js) wins over the block's saved content,
  // so reopening this block after a reload/close restores the in-progress code + settings.
  const [restored] = useState(() => (draftKey ? loadSandboxDraft(draftKey) : null));
  const seed = restored ?? initial;
  // Figure state
  const [type, setType] = useState(seed.type || "canvas");
  const [w, setW] = useState(seed.w || 640);
  const [h, setH] = useState(seed.h || 360);
  const [bg, setBg] = useState(seed.bg || "");
  const [showCode, setShowCode] = useState(Boolean(seed.showCode));
  const [auto, setAuto] = useState(Boolean(seed.auto));
  const [preview, setPreview] = useState(Boolean(seed.preview));
  // Source-lib state
  const [srcLang, setSrcLang] = useState(seed.srcLang || "js");
  const [name, setName] = useState(seed.name || "");
  // Shared
  const [groupId, setGroupId] = useState(seed.id || "");
  const [srcdoc, setSrcdoc] = useState("");
  const [previewW, setPreviewW] = useState(initial.w || 640); // frame width of the *built* preview
  const [playing, setPlaying] = useState(false); // preview starts paused; Play runs it
  // Bumped on every (re)build and reset — used as the iframe key so it always fully remounts.
  // Updating an iframe's srcdoc attribute in place doesn't reliably reload it, so we recreate it.
  const [frameKey, setFrameKey] = useState(0);
  const [dirty, setDirty] = useState(false); // unsaved edits — floats the save button until applied

  const hostRef = useRef(null);
  const cmRef = useRef(null);
  const frameRef = useRef(null);
  const updateRef = useRef(null); // latest updatePreview, so the ⌘S handler (bound once) never goes stale
  const metaInitRef = useRef(false); // skip the mount pass when flagging meta edits dirty
  const draftInitRef = useRef(false); // skip the mount pass when persisting meta edits
  const clearedRef = useRef(false); // stops a pending flush from resurrecting a saved/discarded draft
  const persistRef = useRef(null); // latest persist, so listeners bound once never go stale
  const saveTimer = useRef(null);

  const codeLang = isFigure ? (type === "vue" ? "vue" : "javascript") : (srcLang === "vue" ? "vue" : "javascript");
  const canPlay = isFigure && type !== "vue"; // js figures own the pausable rAF loop

  // Rebuild the preview from the current code + meta. Manual (not on every keystroke) so the
  // author controls when the figure re-runs; the frame reloads paused (see buildSrcdoc control).
  function updatePreview() {
    if (!isFigure) return;
    const body = cmRef.current ? cmRef.current.state.doc.toString() : seed.code || "";
    const width = Number(w) || 0;
    // Sandboxed iframes force a white backdrop that no CSS can make transparent; without an
    // explicit bg, paint the theme's bg so an unpainted canvas blends with the editor.
    const themeBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    setSrcdoc(buildPreview({ type, w: width, h: Number(h) || 0, bg: bg || themeBg, id: groupId }, body, siblings));
    setPreviewW(width || 640);
    setFrameKey((k) => k + 1); // force the iframe to remount with the new srcdoc
    setDirty(false); // edits applied — hide the save button
  }
  updateRef.current = updatePreview; // refreshed every render so ⌘S applies the current code + meta

  // Persist the full working state (code + settings) so an accidental reload/close doesn't lose it.
  const persist = () => {
    if (!draftKey || clearedRef.current) return;
    const code = cmRef.current ? cmRef.current.state.doc.toString() : (seed.code || "");
    saveSandboxDraft(draftKey, { type, w, h, bg, showCode, auto, preview, srcLang, name, id: groupId, code });
  };
  persistRef.current = persist;
  const scheduleSave = () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistRef.current?.(), 500);
  };
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;
  // Drop the draft once the edit session ends (Save or Cancel); guards a pending flush too.
  const finishDraft = () => { clearedRef.current = true; clearTimeout(saveTimer.current); if (draftKey) clearSandboxDraft(); };

  // One-time editor setup, then build the initial preview once.
  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: seed.code || "",
        extensions: [
          lineNumbers(),
          codeFolding(),
          foldGutter({ openText: "⌄", closedText: "›" }),
          // Shared indent/history UX; foldKeymap merges into the shared keymap.
          ...codeServices(foldKeymap),
          // Bracket-match highlight lives only on the code fence, not the Markdown editor.
          bracketMatching(),
          langCompartment.of(langSupport(codeLang)),
          syntaxHighlighting(codeHighlightStyle, { fallback: true }),
          // Read the shared --astro-code-* palette so the editor matches the published code block.
          EditorView.theme({
            "&": { height: "100%", color: "var(--astro-code-foreground, var(--ink))", background: "var(--astro-code-background, var(--bg))" },
            ".cm-content": { caretColor: "var(--astro-code-foreground, var(--ink))" },
            // Scroll-past-end lives on the scroller, not the content, so the editable text box ends at
            // the last line — the trailing space is blank padding you can scroll into, not line area.
            ".cm-scroller": { fontFamily: "'Roboto Mono', ui-monospace, 'SF Mono', monospace", fontSize: "0.85rem", lineHeight: "1.7", paddingBottom: "40vh" },
            "&.cm-focused": { outline: "none" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "color-mix(in srgb, var(--astro-code-foreground, var(--ink)) 22%, transparent)" },
            // Gutters (line numbers + fold) share the editor palette, kept dim so code stays the focus.
            ".cm-gutters": { background: "transparent", border: "none", color: "color-mix(in srgb, var(--astro-code-foreground, var(--ink)) 40%, transparent)" },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 8px", minWidth: "2ch" },
            // Fold chevrons stay hidden so they never clutter the gutter; they fade in on gutter hover.
            ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer", opacity: 0, transition: "opacity 0.12s", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.05rem", lineHeight: "1.7" },
            ".cm-gutters:hover .cm-foldGutter .cm-gutterElement": { opacity: 0.55 },
            ".cm-foldGutter .cm-gutterElement:hover": { opacity: 1 },
            // The expanded "⌄" glyph sits low; nudge it up so it reads centered on the line.
            ".cm-foldGutter [title='Fold line']": { transform: "translateY(-4px)" },
            ".cm-foldGutter [title='Unfold line']": { transform: "translateY(-2px)" },
            // Folded-range marker ("⋯") shown inline where code is collapsed.
            ".cm-foldPlaceholder": { background: "color-mix(in srgb, var(--astro-code-foreground, var(--ink)) 12%, transparent)", border: "none", color: "var(--astro-code-token-comment, var(--ink))", borderRadius: "4px", padding: "0 6px", margin: "0 2px" },
          }),
          EditorView.updateListener.of((u) => {
            // Flag unsaved edits so the floating save button appears; typing itself stays cheap.
            if (u.docChanged) { setDirty(true); scheduleSaveRef.current(); }
          }),
        ],
      }),
      parent: hostRef.current,
    });
    cmRef.current = view;
    view.focus();
    updatePreview();
    return () => { view.destroy(); cmRef.current = null; };
  }, []);

  // Swap the language when it switches (figure type or source lang).
  useEffect(() => {
    if (cmRef.current) cmRef.current.dispatch({ effects: langCompartment.reconfigure(langSupport(codeLang)) });
  }, [codeLang]);

  // Meta edits (size, bg, type, group) also need re-applying — flag them dirty too, but not on mount.
  useEffect(() => {
    if (!metaInitRef.current) { metaInitRef.current = true; return; }
    if (isFigure) setDirty(true);
  }, [type, w, h, bg, groupId]);

  // Persist any settings change too (code changes are caught in the editor's update listener).
  useEffect(() => {
    if (!draftInitRef.current) { draftInitRef.current = true; return; }
    scheduleSaveRef.current();
  }, [type, w, h, bg, showCode, auto, preview, srcLang, name, groupId]);

  // Flush synchronously on unload — the debounce timer won't survive a reload.
  useEffect(() => {
    const flush = () => persistRef.current?.();
    window.addEventListener("pagehide", flush);
    return () => { clearTimeout(saveTimer.current); window.removeEventListener("pagehide", flush); };
  }, []);

  // Any fresh frame (rebuilt preview or explicit reset) starts paused.
  useEffect(() => { setPlaying(false); }, [frameKey]);

  // Size the preview iframe to its content, matching the published figure's self-report.
  useEffect(() => {
    const onMessage = (e) => {
      const height = e.data && e.data.__sandboxHeight;
      if (typeof height !== "number" || height <= 0) return;
      if (frameRef.current && frameRef.current.contentWindow === e.source) {
        frameRef.current.style.height = height + "px";
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      // ESC while editing code is a coding gesture, not "close the modal" — let CodeMirror keep it.
      if (e.key === "Escape") { if (cmRef.current?.hasFocus) return; finishDraft(); onCancel(); return; }
      // ⌘/Ctrl+S applies the current edits to the preview (never the browser's save dialog).
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        updateRef.current?.();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  function togglePlay() {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(playing ? { __figpause: true } : { __figplay: true }, "*");
    setPlaying(!playing);
  }
  function resetFrame() { setFrameKey((k) => k + 1); }

  function save() {
    finishDraft();
    const body = cmRef.current ? cmRef.current.state.doc.toString() : seed.code || "";
    if (isFigure) {
      const state = { type, w: Number(w) || undefined, h: Number(h) || undefined, bg, showCode, auto, preview, id: groupId };
      onSave(buildSandboxFence(state, body));
    } else if (srcLang === "vue") {
      onSave(buildLibFence({ kind: "vue", name, id: groupId }, body));
    } else {
      onSave(buildLibFence({ kind: "source", label: name, id: groupId }, body));
    }
  }

  const isVue = type === "vue";

  return (
    <div className="sbx-modal" role="dialog" aria-modal="true" aria-label={isFigure ? "Edit sandbox figure" : "Edit shared library"}>
      <div className="sbx-head">
        <div className="sbx-toolbar">
          {isFigure ? (
            <>
              <label className="sbx-field">
                <span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {SANDBOX_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="sbx-field">
                <span>Size</span>
                <span className="sbx-size">
                  <input type="number" min="1" value={w} onChange={(e) => setW(e.target.value)} aria-label="Width" />
                  <span aria-hidden="true">×</span>
                  <input type="number" min="1" value={h} onChange={(e) => setH(e.target.value)} aria-label="Height" />
                </span>
              </label>
              <label className="sbx-field">
                <span>Background</span>
                <input type="text" placeholder="#111 / transparent" value={bg} onChange={(e) => setBg(e.target.value)} />
              </label>
              <label className="sbx-field">
                <span>Group</span>
                <input type="text" placeholder="id" value={groupId} onChange={(e) => setGroupId(e.target.value)} />
              </label>
              <div className="sbx-toggles">
                <label className="sbx-check"><input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} /> show code</label>
                {!isVue && <label className="sbx-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-run</label>}
                <label className="sbx-check"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> cover</label>
              </div>
            </>
          ) : (
            <>
              <label className="sbx-field">
                <span>Language</span>
                <select value={srcLang} onChange={(e) => setSrcLang(e.target.value)}>
                  <option value="js">js source</option>
                  <option value="vue">vue component</option>
                </select>
              </label>
              <label className="sbx-field">
                <span>{srcLang === "vue" ? "Component name" : "Label"}</span>
                <input
                  type="text"
                  placeholder={srcLang === "vue" ? "MyWidget" : "what this is"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="sbx-field">
                <span>Group</span>
                <input type="text" placeholder="id" value={groupId} onChange={(e) => setGroupId(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="sbx-actions">
          <button className="sbx-btn save" onClick={save} title="Save">
            <Icon name="check" size={17} /> Save
          </button>
          <button className="sbx-btn" onClick={() => { finishDraft(); onCancel(); }} title="Cancel">
            <Icon name="close" size={17} /> Cancel
          </button>
        </div>
      </div>
      <div className={`sbx-body ${isFigure ? "" : "sbx-body-solo"}`}>
        <div className="sbx-code-pane">
          <div className="sbx-code" ref={hostRef} />
          {isFigure && dirty && (
            <button
              className="sbx-save-fab"
              onClick={updatePreview}
              title="Apply edits to the preview (⌘S)"
              aria-label="Apply edits to the preview"
            >
              <Icon name="save" size={16} />
            </button>
          )}
        </div>
        {isFigure && (
          <div className="sbx-preview">
            <div className="sbx-controls" role="toolbar" aria-label="Preview controls">
              {canPlay && (
                <button className="sbx-ctl sbx-icon" onClick={togglePlay} title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>
                  <Icon name={playing ? "pause" : "play"} size={16} />
                </button>
              )}
              <button className="sbx-ctl sbx-icon" onClick={resetFrame} title="Restart the preview" aria-label="Restart the preview">
                <Icon name="reset" size={16} />
              </button>
            </div>
            <iframe
              key={frameKey}
              ref={frameRef}
              className="sbx-frame"
              style={{ width: `${previewW}px`, maxWidth: "100%" }}
              sandbox="allow-scripts"
              title="live figure preview"
              srcDoc={srcdoc}
            />
          </div>
        )}
      </div>
    </div>
  );
}
