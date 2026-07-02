// Publish helpers for the dev publish middleware (devPublish in astro.config.mjs):
// the bits that decide *what a valid entry looks like* — path confinement,
// filename/slug derivation, frontmatter parsing, the blank-title heuristic, the
// upload allow-list. Kept here (not inline in the config) as one tidy, testable
// module, and pure — only String/RegExp/Set/JSON and the global `crypto.randomUUID`,
// no fs/Request/env — so it's trivially importable. Tags reuse parseTags from
// tags.js so tag normalization stays single-source.

import { parseTags } from './tags.js';

// Re-exported so callers need only one import for all publish helpers; devPublish
// calls this `parseTags` directly to normalize incoming tags.
export { parseTags };

// --- Entry path confinement -------------------------------------------------
// A publishable/deletable entry path must live in the posts dir and be a `.md`
// file. The `..` check is load-bearing, not cosmetic: dev feeds this path into
// join(root(), path), which resolves `..`, so without it a crafted
// `src/content/posts/../../README.md` clears the prefix/suffix test yet escapes
// the dir. Reject rather than normalize: real slugs are [a-z0-9-], never `..`.
export function isValidPostPath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('src/content/posts/') &&
    path.endsWith('.md') &&
    !path.includes('..')
  );
}

// Slugify a title into a filename tail / URL slug: lowercase, runs of non-alnum →
// a single '-', trim leading/trailing '-', length-cap. Empty result → the
// fallback. Posts cap at 60 ('entry'); upload basenames cap at 40 ('image').
export function slugify(s, max = 60, fallback = 'entry') {
  return (
    String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || fallback
  );
}

// --- Upload allow-list ------------------------------------------------------
// Raster image types only. SVG is deliberately excluded: it's an active-content
// format (it can carry <script>) and uploads are served from our own origin, so
// allowing it would be a stored-XSS vector. The served Content-Type is decided by
// the filename extension, so the resolved ext — whether from the declared MIME
// type or the original name — must land in this allow-list.
const UPLOAD_TYPE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif',
};
const ALLOWED_UPLOAD_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);

// Safe, collision-resistant upload filename: <slug-of-name>-<short-id>.<ext>.
// Returns null when the type/extension isn't an allowed raster image, so the
// caller can 415 / reject.
export function uploadFilename(name = 'image', type = '') {
  // Prefer the declared MIME type; fall back to the name's own extension.
  let ext = UPLOAD_TYPE_EXT[type];
  if (!ext) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    ext = m ? m[1].toLowerCase() : '';
  }
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) return null;
  const base = slugify(name.replace(/\.[^.]*$/, ''), 40, 'image');
  return `${base}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
}

// --- Frontmatter readers ----------------------------------------------------
// Match only the leading `---` block, so a later mention in prose can't be read
// as frontmatter. Shared by frontmatterTitle / frontmatterTags.
const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

// The raw `tags:` value from a file's leading frontmatter (used to preserve tags
// across an edit when the client didn't send them). Unwraps a JSON-quoted string
// ("a, b") or a YAML flow array ([a, b]); parseTags then splits it.
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

// The `title:` value from a file's leading frontmatter. Unwraps the JSON-quoted
// form we persist ("My entry") and a single-quoted scalar; otherwise returns the
// raw value. Used only by devPublish's dev-only /data/*.json mirror, which builds
// entry summaries straight from disk (where there's no astro:content to read).
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

// The `updated:` value from a file's leading frontmatter, or '' if none. We write
// it as a bare ISO string (no quotes), so the raw value is returned as-is. Used by
// the dev-only /admin/api/entry read endpoint so the editor can restore it.
export function frontmatterUpdated(text) {
  const m = FRONTMATTER.exec(text || '');
  if (!m) return '';
  const line = /^[ \t]*updated:[ \t]*(.+?)[ \t]*$/m.exec(m[1]);
  return line ? line[1].trim() : '';
}

// The markdown body — everything after the leading frontmatter block (matching
// what astro:content hands the read view as `post.body`), with the blank line(s)
// the writer inserts after the closing `---` trimmed off. Used by the same read
// endpoint to seed the editor's document.
export function entryBody(text) {
  const t = text || '';
  const m = FRONTMATTER.exec(t);
  return (m ? t.slice(m[0].length) : t).replace(/^\n+/, '');
}

// --- Blank-title heuristic --------------------------------------------------
// The first prose paragraph — skips blank lines, headings, images and quotes, so
// the title is drawn from what the entry actually opens with (the input to
// fallbackTitle below).
export function firstParagraph(md) {
  for (const block of md.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || /^(#{1,6}\s|!\[|>)/.test(text)) continue;
    return text.replace(/\s+/g, ' ').slice(0, 1500);
  }
  return md.trim().replace(/\s+/g, ' ').slice(0, 1500);
}

// Cheap, deterministic title when the author leaves one blank: the opening few
// words, Title Cased. Unicode-aware so non-Latin scripts (Korean etc.) survive;
// no letters/numbers at all → "Untitled".
export function fallbackTitle(md) {
  const words = firstParagraph(md).split(' ').filter(Boolean).slice(0, 6).join(' ');
  const cleaned = words.replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : 'Untitled';
}
