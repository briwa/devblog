import { useEffect, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { vue } from "@codemirror/lang-vue";
import Icon from "../Icon.jsx";
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

export default function SandboxModal({ kind = "figure", initial, siblings = [], onSave, onCancel }) {
  const isFigure = kind === "figure";
  // Figure state
  const [type, setType] = useState(initial.type || "canvas");
  const [w, setW] = useState(initial.w || 640);
  const [h, setH] = useState(initial.h || 360);
  const [bg, setBg] = useState(initial.bg || "");
  const [showCode, setShowCode] = useState(Boolean(initial.showCode));
  const [auto, setAuto] = useState(Boolean(initial.auto));
  const [preview, setPreview] = useState(Boolean(initial.preview));
  // Source-lib state
  const [srcLang, setSrcLang] = useState(initial.srcLang || "js");
  const [name, setName] = useState(initial.name || "");
  // Shared
  const [groupId, setGroupId] = useState(initial.id || "");
  const [code, setCode] = useState(initial.code || "");
  const [srcdoc, setSrcdoc] = useState("");
  const [playing, setPlaying] = useState(true);
  const [resetKey, setResetKey] = useState(0);

  const hostRef = useRef(null);
  const cmRef = useRef(null);
  const frameRef = useRef(null);

  const codeLang = isFigure ? (type === "vue" ? "vue" : "javascript") : (srcLang === "vue" ? "vue" : "javascript");
  const canPlay = isFigure && type !== "vue"; // js figures own the pausable rAF loop

  // One-time editor setup; code changes flow out through the update listener.
  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: initial.code || "",
        extensions: [
          history(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          langCompartment.of(langSupport(codeLang)),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.theme({
            "&": { height: "100%", color: "var(--ink)" },
            ".cm-content": { caretColor: "var(--ink)" },
            ".cm-scroller": { fontFamily: "'Roboto Mono', ui-monospace, 'SF Mono', monospace", fontSize: "0.85rem", lineHeight: "1.7" },
            "&.cm-focused": { outline: "none" },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setCode(u.state.doc.toString());
          }),
        ],
      }),
      parent: hostRef.current,
    });
    cmRef.current = view;
    view.focus();
    return () => { view.destroy(); cmRef.current = null; };
  }, []);

  // Swap the language when it switches (figure type or source lang).
  useEffect(() => {
    if (cmRef.current) cmRef.current.dispatch({ effects: langCompartment.reconfigure(langSupport(codeLang)) });
  }, [codeLang]);

  // Debounce the preview so the iframe rebuilds on a pause, not every keystroke (figures only).
  useEffect(() => {
    if (!isFigure) return;
    const id = setTimeout(() => {
      // Sandboxed iframes force a white backdrop that no CSS can make transparent; without an
      // explicit bg, paint the theme's bg so an unpainted canvas blends with the editor.
      const themeBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      setSrcdoc(buildPreview({ type, w: Number(w) || 0, h: Number(h) || 0, bg: bg || themeBg, id: groupId }, code, siblings));
    }, 300);
    return () => clearTimeout(id);
  }, [isFigure, type, w, h, bg, groupId, code, siblings]);

  // A fresh frame (new srcdoc or explicit reset) always starts running.
  useEffect(() => { setPlaying(true); }, [srcdoc, resetKey]);

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
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function togglePlay() {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(playing ? { __figpause: true } : { __figplay: true }, "*");
    setPlaying(!playing);
  }
  function resetFrame() { setResetKey((k) => k + 1); }

  function save() {
    const body = cmRef.current ? cmRef.current.state.doc.toString() : code;
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
          <button className="sbx-btn" onClick={onCancel} title="Cancel">
            <Icon name="close" size={17} /> Cancel
          </button>
        </div>
      </div>
      <div className={`sbx-body ${isFigure ? "" : "sbx-body-solo"}`}>
        <div className="sbx-code" ref={hostRef} />
        {isFigure && (
          <div className="sbx-preview">
            <div className="sbx-controls" role="toolbar" aria-label="Preview controls">
              {canPlay && (
                <button className="sbx-ctl" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
                  {playing ? "Pause" : "Play"}
                </button>
              )}
              <button className="sbx-ctl" onClick={resetFrame} title="Reset">Reset</button>
            </div>
            <iframe
              key={resetKey}
              ref={frameRef}
              className="sbx-frame"
              style={{ width: `${Number(w) || 640}px`, maxWidth: "100%" }}
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
