import { fmtWeekday as fmt, fmtWeekdayTime as fmtTime } from "../lib/dates.js";

export default function EntryDates({ created, updated = null, pagefind = false, onEditDate = null }) {
  if (!created) return null;

  const showUpdated = updated && fmt(updated) !== fmt(created);
  return (
    <div className="entry-dates">
      {onEditDate ? (
        <button type="button" className="entry-meta entry-date-edit" onClick={onEditDate} title="Change the creation date">
          {fmt(created)}
        </button>
      ) : (
        <span className="entry-meta" {...(pagefind ? { "data-pagefind-meta": "date" } : {})}>{fmt(created)}</span>
      )}
      {showUpdated && <span className="entry-meta entry-updated" title={fmtTime(updated)}>edited</span>}
    </div>
  );
}
