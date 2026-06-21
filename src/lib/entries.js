import { getCollection } from 'astro:content';
// Shapes live in the astro:content-free entryData.js so devPublish's dev mirror can reuse them; re-exported here.
export { yearsOf, entriesByYear, published, drafts } from './entryData.js';

export async function loadPosts() {
  return getCollection('posts');
}

export const jsonResponse = (data) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
