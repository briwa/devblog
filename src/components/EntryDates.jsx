// The entry's date line — created day, plus "Updated …" when an edit landed on
// a different day. Shared by the static entry page (Astro renders this to plain
// HTML, no client directive — so Pagefind still indexes the date) and the React
// editor, so the formatting + the "show updated?" rule live in exactly one
// place. Dates come in as ISO strings; rendered in UTC to match the rest of the
// site (dates are anchored at UTC midnight — see src/lib/created.js).
const fmt = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export default function EntryDates({ created, updated = null, pagefind = false }) {
  if (!created) return null; // a brand-new entry before its day is stamped
  // Same-day edits aren't worth a second timestamp.
  const showUpdated = updated && fmt(updated) !== fmt(created);
  return (
    <div className="entry-dates">
      {/* On the static page this attribute makes the date filterable/displayable
          search meta; the editor passes pagefind=false. */}
      <span className="entry-meta" {...(pagefind ? { "data-pagefind-meta": "date" } : {})}>{fmt(created)}</span>
      {showUpdated && <span className="entry-meta entry-updated">Updated {fmt(updated)}</span>}
    </div>
  );
}
