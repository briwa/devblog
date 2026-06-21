import { createdOf } from './created.js';
import { parseTags } from './tags.js';

// The shapes the home's /data endpoints emit, kept PURE (no astro:content) so the
// same code serves both worlds: the real prerendered endpoints (src/pages/data/*,
// fed by getCollection via src/lib/entries.js) and the dev mirror (devPublish in
// astro.config.mjs, fed by reading the posts dir). The Vite config can't import
// astro:content, so without this split devPublish would hand-mirror the summary
// shape, the UTC date and the year list — exactly the drift src/lib/publish.js
// was extracted to avoid. Both sides just supply the minimal post-like shape
// these operate on: { id, data: { title, tags } } — what getCollection yields,
// and what devPublish builds from each file's frontmatter.

// The serializable per-entry summary the home consumes. `iso` is the
// filename-derived UTC creation day (createdOf) — the single source of truth for
// an entry's date; tags are normalized via parseTags.
export const entrySummary = (p) => ({
  id: p.id,
  title: p.data.title,
  iso: createdOf(p).toISOString(),
  tags: parseTags(p.data.tags),
});

// Years that have entries, newest first. (The filename's YYYY prefix is the UTC
// year — see created.js.)
export const yearsOf = (posts) =>
  [...new Set(posts.map((p) => Number(p.id.slice(0, 4))))].sort((a, b) => b - a);

// A getStaticPaths() result: one page per UTC creation year, its entries as props.
export function entriesByYear(posts) {
  const byYear = {};
  for (const p of posts) (byYear[p.id.slice(0, 4)] ||= []).push(entrySummary(p));
  return Object.entries(byYear).map(([year, entries]) => ({ params: { year }, props: { entries } }));
}
