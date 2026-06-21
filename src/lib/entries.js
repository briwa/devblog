import { getCollection } from 'astro:content';
// The serializable shapes (entry summary, year list, per-year grouping) live in
// the astro:content-free src/lib/entryData.js so devPublish's dev mirror can reuse
// them (the Vite config can't import astro:content). Re-exported here so the
// /data/* endpoints keep importing them from this one module.
export { yearsOf, entriesByYear } from './entryData.js';

// Backing for the /data/* endpoints. The home fetches these per-year at runtime
// (rather than baking the data into the page) so the static HTML doesn't grow
// with the archive — see entryData.js for the shape.
export async function loadPosts() {
  return getCollection('posts');
}

export const jsonResponse = (data) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
