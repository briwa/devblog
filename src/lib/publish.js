// Publish helpers for the dev publish middleware (devPublish in astro.config.mjs).
// Kept pure (no fs/Request/env) so it's trivially importable and testable.

import { parseTags } from './tags.js';

// Re-exported so callers need only one import for all publish helpers.
export { parseTags };

// --- Entry path confinement -------------------------------------------------
// The `..` check is load-bearing: dev feeds this into join(root(), path), which
// resolves `..`, so a crafted `posts/../../README.md` would otherwise escape the dir.
export function isValidPostPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('src/content/posts/') &&
    path.endsWith('.md') &&
    !path.includes('..')
  );
}

// Swap the YYYY-MM-DD day prefix in a filename for a new day (the creation day lives
// in the filename, so changing it is a rename). Malformed paths pass through unchanged.
export function withDate(path, ymd) {
  return path.replace(
    /^(src\/content\/posts\/)\d{4}-\d{2}-\d{2}(-.*\.md)$/,
    `$1${ymd}$2`,
  );
}

// Slugify a title into a filename tail / URL slug; empty result → the fallback.
export function slugify(s, max = 60, fallback = 'entry') {
  return (
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || fallback
  );
}

export async function uniquePostPath(iso, title, exists) {
  const base = `src/content/posts/${iso.slice(0, 10)}-${slugify(title)}`;
  let path = `${base}.md`;
  for (let n = 2; await exists(path); n++) path = `${base}-${n}.md`;
  return path;
}

// --- Upload allow-list ------------------------------------------------------
// Raster only. SVG is excluded: it's active content (<script>) served from our own
// origin, so allowing it would be a stored-XSS vector.
const UPLOAD_TYPE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif',
};
const ALLOWED_UPLOAD_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);

// Safe, collision-resistant upload filename; null when the type isn't allowed.
export function uploadFilename(name = 'image', type = '') {
  let ext = UPLOAD_TYPE_EXT[type];
  if (!ext) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    ext = m ? m[1].toLowerCase() : '';
  }
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) return null;
  const base = slugify(name.replace(/\.[^.]*$/, ''), 40, 'image');
  return `${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
}

export function isValidUploadPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('public/uploads/') &&
    !path.includes('..') &&
    ALLOWED_UPLOAD_EXTS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase())
  );
}

export function uploadRefs(text) {
  const refs = new Set();
  const re = /\/uploads\/([A-Za-z0-9._-]+)/g;
  let m;
  while ((m = re.exec(text || ''))) refs.add(m[1]);
  return [...refs];
}

// --- Frontmatter readers ----------------------------------------------------
// Match only the leading `---` block, so a later mention in prose isn't read as frontmatter.
const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

// The raw `tags:` value, to preserve tags across an edit when the client didn't send them.
export function frontmatterTags(text) {
  const m = FRONTMATTER.exec(text || '');
  if (!m) return '';
  const line = /^[ \t]*tags:[ \t]*(.+?)[ \t]*$/m.exec(m[1]);
  if (!line) return '';
  let v = line[1];
  if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { /* keep raw */ } }
  else if (v.startsWith('[')) v = v.replace(/^\[|\]$/g, '').replace(/["']/g, '');
  return v;
}

// The `title:` value, for devPublish's dev-only /data/*.json mirror (no astro:content on disk).
export function frontmatterTitle(text) {
  const m = FRONTMATTER.exec(text || '');
  if (!m) return '';
  const line = /^[ \t]*title:[ \t]*(.+?)[ \t]*$/m.exec(m[1]);
  if (!line) return '';
  let v = line[1];
  if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { /* keep raw */ } }
  else if (v.startsWith("'")) v = v.replace(/^'|'$/g, '');
  return v;
}

// The `updated:` value (bare ISO string), or '', for the editor to restore on edit.
export function frontmatterUpdated(text) {
  const m = FRONTMATTER.exec(text || '');
  if (!m) return '';
  const line = /^[ \t]*updated:[ \t]*(.+?)[ \t]*$/m.exec(m[1]);
  return line ? line[1].trim() : '';
}

// The `draft:` flag. Written as a bare `true` (line omitted when published), so
// anything other than the literal `true` — including a missing line — is published.
export function frontmatterDraft(text) {
  const m = FRONTMATTER.exec(text || '');
  if (!m) return false;
  const line = /^[ \t]*draft:[ \t]*(.+?)[ \t]*$/m.exec(m[1]);
  return line ? line[1].trim() === 'true' : false;
}

// The markdown body — everything after the leading frontmatter, leading blanks trimmed.
export function entryBody(text) {
  const t = text || '';
  const m = FRONTMATTER.exec(t);
  return (m ? t.slice(m[0].length) : t).replace(/^\n+/, '');
}

// --- Blank-title heuristic --------------------------------------------------
// The first prose paragraph — skips blank lines, headings, images and quotes.
export function firstParagraph(md) {
  for (const block of md.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#{1,6}\s|!\[|>)/.test(text)) continue;
    return text.replace(/\s+/g, ' ').slice(0, 1500);
  }
  return md.trim().replace(/\s+/g, ' ').slice(0, 1500);
}

// Cheap fallback title from the opening words, Title Cased. Unicode-aware so
// non-Latin scripts survive; no letters/numbers → "Untitled".
export function fallbackTitle(md) {
  const words = firstParagraph(md).split(' ').filter(Boolean).slice(0, 6).join(' ');
  const cleaned = words.replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : 'Untitled';
}
