import { useEffect, useRef, useState } from "react";
import Icon from "../Icon.jsx";
import { setFind, moveFind, clearFind, findInfo } from "../../lib/editorFind.js";

// A browser-style find-in-page bar for a CodeMirror view. Cmd/Ctrl+F opens it (only when the paired
// editor — or the bar itself — has focus, so it never hijacks find from another editor on the page),
// Esc closes, Enter / Shift+Enter cycle matches. Render it inside a positioned box; CSS pins it top-right.
//   viewRef  — ref to the EditorView (must include the `editorFind` extension from editorSetup)
//   scopeRef — ref to the DOM element whose focus counts as "this editor" (e.g. the CM host)
export default function EditorFind({ viewRef, scopeRef }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [info, setInfo] = useState({ current: 0, total: 0 });
  const inputRef = useRef(null);

  const refresh = () => { const v = viewRef.current; if (v) setInfo(findInfo(v)); };

  // Focus the input once it's actually mounted — on the keypress that opens the bar it doesn't exist yet.
  useEffect(() => { if (open) { inputRef.current?.focus(); inputRef.current?.select(); } }, [open]);
  const move = (dir) => { const v = viewRef.current; if (v) { moveFind(v, dir); refresh(); } };
  const close = () => {
    setOpen(false);
    const v = viewRef.current;
    if (v) { clearFind(v); v.focus(); }
  };

  // All key handling lives in one document-capture listener so it runs before the editors' own
  // capture handlers (the sandbox modal closes on a bare Escape — the find bar must win that key).
  useEffect(() => {
    const onKey = (e) => {
      const bar = inputRef.current;
      const inBar = bar && document.activeElement === bar;
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        const v = viewRef.current;
        const inScope = scopeRef?.current?.contains(document.activeElement);
        if (!open && !inScope && !inBar) return; // some other editor's Cmd+F — leave it be
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        // Seed from the editor's selection, the way a browser's find does.
        const sel = v?.state.selection.main;
        if (sel && !sel.empty && sel.to - sel.from < 100) {
          const text = v.state.sliceDoc(sel.from, sel.to);
          setQuery(text);
          setFind(v, text);
          refresh();
        }
        // First open focuses via the [open] effect (input isn't mounted yet here); a repeat
        // press while already open re-focuses and re-selects the existing input now.
        if (open && bar) { bar.focus(); bar.select(); }
        return;
      }
      if (!open || !inBar) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); move(e.shiftKey ? -1 : 1); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const onChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    const v = viewRef.current;
    if (v) { setFind(v, q); refresh(); }
  };

  return (
    <div className="editor-find" role="search">
      <input
        ref={inputRef}
        className="editor-find-input"
        value={query}
        onChange={onChange}
        placeholder="Find"
        aria-label="Find in editor"
        spellCheck={false}
      />
      <span className={`editor-find-count ${query && !info.total ? "is-none" : ""}`}>
        {query ? `${info.current}/${info.total}` : ""}
      </span>
      <button className="editor-find-btn" onClick={() => move(-1)} disabled={!info.total} aria-label="Previous match" title="Previous (⇧⏎)">
        <Icon name="chevronUp" size={15} />
      </button>
      <button className="editor-find-btn" onClick={() => move(1)} disabled={!info.total} aria-label="Next match" title="Next (⏎)">
        <Icon name="chevronDown" size={15} />
      </button>
      <button className="editor-find-btn" onClick={close} aria-label="Close find" title="Close (Esc)">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
