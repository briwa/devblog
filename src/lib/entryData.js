import { createdOf } from './created.js';
import { parseTags } from './tags.js';

// Kept PURE (no astro:content) so both the prerendered /data endpoints and devPublish's dev mirror share one definition.
// Both sides supply the minimal post-like shape: { id, data: { title, tags } }.
export const entrySummary = (p) => ({
  id: p.id,
  title: p.data.title,
  iso: createdOf(p).toISOString(),
  tags: parseTags(p.data.tags),
});

// Draft partitioning in one place so "what counts as published" is decided once.
export const isDraft = (p) => Boolean(p.data.draft);
export const published = (posts) => posts.filter((p) => !isDraft(p));
export const drafts = (posts) => posts.filter(isDraft);

// Years that have entries, newest first.
export const yearsOf = (posts) =>
  [...new Set(posts.map((p) => Number(p.id.slice(0, 4))))].sort((a, b) => b - a);

export function entriesByYear(posts) {
  const byYear = {};
  for (const p of posts) (byYear[p.id.slice(0, 4)] ||= []).push(entrySummary(p));
  return Object.entries(byYear).map(([year, entries]) => ({ params: { year }, props: { entries } }));
}
