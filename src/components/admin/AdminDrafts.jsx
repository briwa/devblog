import MoreTags from "../MoreTags.jsx";
import { tagClass } from "../../lib/tags.js";
import { fmtMedium as fmtDay } from "../../lib/dates.js";

export default function AdminDrafts({ drafts = [] }) {
  return (
    <div className="home admin-drafts">
      <div className="hm-head">
        <div className="hm-years">
          <a href="/" className="hm-drafts">← Home</a>
        </div>
      </div>

      {drafts.length === 0 ? (<p className="month-empty">No drafts.</p>) : (
        <div className="month-region">
          <ul className="month-list">
            {drafts.map((e) => (
              <li key={e.id}>
                <a href={`/admin/edit?post=${e.id}`}>
                  <span className="ml-title">{e.title}</span>
                  {e.tags && e.tags.length > 0 && (
                    <span className="ml-tags">
                      {e.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className={tagClass(tag)} title={tag}>
                          <span className="tag-label">{tag}</span>
                        </span>
                      ))}
                      {e.tags.length > 2 && <MoreTags tags={e.tags.slice(2)} />}
                    </span>
                  )}
                  <span className="ml-date">{fmtDay(e.iso)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
