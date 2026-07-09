import { getCollection } from 'astro:content';
import { published } from '../../lib/entryData.js';
import { parseTags } from '../../lib/tags.js';
import { jsonResponse } from '../../lib/entries.js';
import { entryPreview, HOME_RECENT } from '../../lib/entryPreview.js';

export const GET = async () => {
  const posts = published(await getCollection('posts')).sort((a, b) => b.id.localeCompare(a.id));
  const cards = posts.slice(0, HOME_RECENT + 1).map((p) => ({
    id: p.id,
    title: p.data.title,
    iso: `${p.id.slice(0, 10)}T00:00:00.000Z`,
    tags: parseTags(p.data.tags),
    ...entryPreview(p.body || ''),
  }));
  return jsonResponse({ spotlight: cards[0] || null, recent: cards.slice(1) });
};
