import { useEffect, useState } from "react";
import EntryEditor from "./EntryEditor.jsx";

// The /admin/edit?post=<id> page. There's a single, generic edit page rather than
// one prerendered per entry, so it loads the target entry's source at runtime from
// the /admin/api/entry read endpoint, then hands it to the (prop-driven) EntryEditor
// exactly as the old per-post page did server-side. Editing is dev/flag-gated, so
// that endpoint is the devPublish middleware in dev (and would be the real backend
// once prod editing is enabled).
export default function AdminEdit() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("post");
    if (!id) {
      setState({ status: "error", msg: "No entry specified (missing ?post=)." });
      return;
    }
    fetch(`/admin/api/entry?post=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `Couldn’t load entry (${res.status})`);
        setState({ status: "ready", entry: { ...d, id } });
      })
      .catch((e) => setState({ status: "error", msg: e.message }));
  }, []);

  if (state.status !== "ready") {
    return (
      <div className="entry">
        <p className="admin-loading">
          {state.status === "error" ? state.msg : "Loading…"}
        </p>
        {state.status === "error" && <a className="back" href="/">← Home</a>}
      </div>
    );
  }

  const e = state.entry;
  return (
    <EntryEditor
      markdown={e.markdown}
      title={e.title}
      date={e.created}
      updated={e.updated}
      path={`src/content/posts/${e.id}.md`}
      tags={e.tags}
    />
  );
}
