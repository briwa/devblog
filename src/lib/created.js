// An entry's creation day is derived from its filename — the entry `id` is
// prefixed `YYYY-MM-DD` (e.g. `2026-06-20-struggling-to-start`). There is no
// `date` frontmatter field: the filename is the single source of truth.
//
// The editor files new entries under the author's *local* day, and the site
// renders all dates in UTC, so we anchor the derived date at UTC midnight — it
// then displays as that same local day everywhere.
export const createdOf = (entry) => new Date(`${entry.id.slice(0, 10)}T00:00:00.000Z`);
