import { fmtMedium } from "../../lib/dates.js";
import PostRow from "../PostRow.jsx";

export default function AdminList({ entries = [] }) {
  return (
    <div className="archive admin-list">
      <div className="ar-head">
        <a href="/" className="hm-drafts">← Home</a>
      </div>

      {entries.length === 0 ? (
        <p className="ar-empty">No entries.</p>
      ) : (
        <div className="ar-list">
          {entries.map((e) => (
            <PostRow key={e.id} href={`/admin/posts/${e.id}/`} title={e.title} tags={e.tags} date={fmtMedium(e.iso)} draft={e.draft} />
          ))}
        </div>
      )}
    </div>
  );
}
