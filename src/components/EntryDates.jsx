// The entry's date line — created day, plus "Updated …" when an edit landed on
// a different day. Shared by the static entry page (Astro renders this to plain
// HTML, no client directive — so Pagefind still indexes the date) and the React
// editor, so the formatting + the "show updated?" rule live in exactly one
// place. Dates come in as ISO strings; rendered in UTC to match the rest of the
// site (dates are anchored at UTC midnight — see src/lib/created.js).
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// 1->"1st", 2->"2nd", 3->"3rd", 11-13->"th", everything else by last digit.
const ordinal = (n) => {
  const teen = n % 100;
  const suffix = teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${suffix}`;
};
// "Mon, Jun 22nd 2026".
const fmt = (iso) => {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())} ${d.getUTCFullYear()}`;
};
// Same, plus HH:MM:SS — used for the edit tooltip, where the exact wall-clock time
// is meaningful (the `updated` stamp is local time wearing a Z, so reading the UTC
// fields gives back that local wall-clock — see EntryEditor's localStamp).
const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (iso) => {
  const d = new Date(iso);
  return `${fmt(iso)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

export default function EntryDates({ created, updated = null, pagefind = false }) {
  if (!created) return null; // a brand-new entry before its day is stamped
  // Same-day edits aren't worth a second timestamp.
  const showUpdated = updated && fmt(updated) !== fmt(created);
  return (
    <div className="entry-dates">
      {/* On the static page this attribute makes the date filterable/displayable
          search meta; the editor passes pagefind=false. */}
      <span className="entry-meta" {...(pagefind ? { "data-pagefind-meta": "date" } : {})}>{fmt(created)}</span>
      {/* The update only shows a terse italic "updated" to save space; the actual
          date lives in the title tooltip. */}
      {showUpdated && <span className="entry-meta entry-updated" title={fmtTime(updated)}>edited</span>}
    </div>
  );
}
