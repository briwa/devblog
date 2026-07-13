import { useEffect, useRef, useState } from "react";
import Icon from "../Icon.jsx";
import { buildLibFence, safeUrl } from "../../lib/sandbox.js";

// Small centered modal for an external-lib block: one https .js URL per line, plus an
// optional label and group. The body is the URL list; sandboxExternals validates it later.
export default function SandboxExternalModal({ initial, onSave, onCancel }) {
  const [urls, setUrls] = useState(initial.code || "");
  const [label, setLabel] = useState(initial.label || "");
  const [groupId, setGroupId] = useState(initial.id || "");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const lines = urls.split(/\s+/).filter(Boolean);
  const bad = lines.filter((u) => !safeUrl(u));

  function save() {
    onSave(buildLibFence({ kind: "external", label, id: groupId }, lines.join("\n")));
  }

  return (
    <div className="sbx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sbx-dialog" role="dialog" aria-modal="true" aria-label="External library">
        <h2 className="sbx-dialog-title">External library</h2>
        <label className="sbx-field sbx-field-block">
          <span>URLs — one https .js per line</span>
          <textarea
            ref={inputRef}
            className="sbx-urls"
            rows={4}
            placeholder="https://cdn.jsdelivr.net/npm/…/dist/thing.min.js"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
          />
        </label>
        {bad.length > 0 && (
          <p className="sbx-warn">Ignored (not an https .js URL): {bad.join(", ")}</p>
        )}
        <div className="sbx-dialog-row">
          <label className="sbx-field">
            <span>Label</span>
            <input type="text" placeholder="what this is" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="sbx-field">
            <span>Group</span>
            <input type="text" placeholder="id" value={groupId} onChange={(e) => setGroupId(e.target.value)} />
          </label>
        </div>
        <div className="sbx-actions">
          <button className="sbx-btn save" onClick={save} disabled={!lines.length} title="Save">
            <Icon name="check" size={17} /> Save
          </button>
          <button className="sbx-btn" onClick={onCancel} title="Cancel">
            <Icon name="close" size={17} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
