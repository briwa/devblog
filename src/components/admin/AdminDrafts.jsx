import { fmtMedium } from "../../lib/dates.js";
import PostRow from "../PostRow.jsx";

export default function AdminDrafts({ drafts = [] }) {
  return (
    <div className="archive admin-drafts">
      <div className="ar-head">
        <a href="/archive" className="hm-drafts">← Archive</a>
      </div>

      {drafts.length === 0 ? (
        <p className="ar-empty">No drafts.</p>
      ) : (
        <div className="ar-list">
          {drafts.map((e) => (
            <PostRow key={e.id} href={`/admin/edit?post=${e.id}`} title={e.title} tags={e.tags} date={fmtMedium(e.iso)} />
          ))}
        </div>
      )}
    </div>
  );
}
