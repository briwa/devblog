import { fmtMedium } from "../../lib/dates.js";

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
            <a className="ar-row" key={e.id} href={`/admin/edit?post=${e.id}`}>
              <span className="ar-row-main">
                <span className="ar-row-title">{e.title}</span>
                {e.tags?.length > 0 && (
                  <span className="hashtags ar-row-tags">
                    {e.tags.map((tag) => <span className="hashtag" key={tag}>#{tag}</span>)}
                  </span>
                )}
              </span>
              <span className="ar-row-date">{fmtMedium(e.iso)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
