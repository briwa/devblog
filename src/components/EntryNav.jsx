import { useEffect, useState } from "react";

// Prev/next entry navigation, rendered on the client: it resolves neighbours at
// runtime from /data/<year>.json (the same per-year data the home uses), so the
// neighbour list doesn't have to be baked into every entry's static HTML.

const fmtFull = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

// A year's entries ({ id, title, iso }), oldest first — the id is `YYYY-MM-DD-slug`
// so a string sort is chronological. Returns [] on a miss (e.g. a year with no
// entries the viewer may see).
const fetchYear = async (year) => {
  try {
    const r = await fetch(`/data/${year}.json`);
    if (!r.ok) return [];
    const list = await r.json();
    return Array.isArray(list) ? [...list].sort((a, b) => a.id.localeCompare(b.id)) : [];
  } catch {
    return [];
  }
};

export default function EntryNav({ id }) {
  const [nav, setNav] = useState(null); // { newer, older }, each {id,title,iso} | null

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const year = Number(id.slice(0, 4));
      // years.json (the set of years the viewer may see) + this entry's year.
      const [years, entries] = await Promise.all([
        fetch("/data/years.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetchYear(year),
      ]);
      const yearList = Array.isArray(years) ? years : [];
      const i = entries.findIndex((e) => e.id === id);

      // Older neighbour: the previous entry in-year, else the latest entry of
      // the nearest older year that has any.
      let older = i > 0 ? entries[i - 1] : null;
      if (!older) {
        const olderYear = yearList.filter((y) => y < year).sort((a, b) => b - a)[0];
        if (olderYear != null) { const list = await fetchYear(olderYear); older = list[list.length - 1] || null; }
      }

      // Newer neighbour: the next entry in-year, else the earliest entry of the
      // nearest newer year that has any.
      let newer = i >= 0 && i < entries.length - 1 ? entries[i + 1] : null;
      if (!newer) {
        const newerYear = yearList.filter((y) => y > year).sort((a, b) => a - b)[0];
        if (newerYear != null) { const list = await fetchYear(newerYear); newer = list[0] || null; }
      }

      if (!cancelled) setNav({ newer, older });
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Render nothing until resolved (no flash of wrong links), and nothing at all
  // when this is the only entry the viewer can see.
  if (!nav || (!nav.newer && !nav.older)) return null;

  // The home list runs newest-first, so navigation follows the same descending
  // order: ← steps back toward newer entries, → steps forward into older ones.
  return (
    <nav className="entry-nav">
      {nav.newer ? (
        <a className="entry-nav-link prev" href={`/posts/${nav.newer.id}/`}>
          <span className="nav-arrow">←</span>
          <span className="nav-text">
            <span className="nav-t">{nav.newer.title}</span>
            <span className="nav-d">{fmtFull(nav.newer.iso)}</span>
          </span>
        </a>
      ) : (
        <span></span>
      )}
      {nav.older ? (
        <a className="entry-nav-link next" href={`/posts/${nav.older.id}/`}>
          <span className="nav-text">
            <span className="nav-t">{nav.older.title}</span>
            <span className="nav-d">{fmtFull(nav.older.iso)}</span>
          </span>
          <span className="nav-arrow">→</span>
        </a>
      ) : (
        <span></span>
      )}
    </nav>
  );
}
