// Tags live in an entry's frontmatter as a single comma-separated string
// (`tags: "Food, Daily Life, Seoul"`) — spaces are allowed *within* a tag, the
// comma is the only separator. We keep the stored form a plain string (not a
// YAML list) because that's what the editor types and what reads cleanly in the
// source; hand-written YAML flow arrays still parse (see parseTags / the schema).
//
// This module is the single source of truth for tag normalization, shared by the
// entry page (Astro), the home list and the editor (React) — and, via
// src/lib/publish.js, by the dev publish middleware (devPublish in
// astro.config.mjs). So parseTags has exactly one definition.

// Normalize whatever frontmatter / payload gives us into a clean tag array:
// trim, collapse inner whitespace, drop blanks, and de-dupe case-insensitively
// while preserving the first-seen casing and order. Accepts the stored string,
// a YAML array, or already-split input.
export function parseTags(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(",");
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const tag = String(raw).trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// The comma-separated string we persist back into frontmatter.
export function serializeTags(tags) {
  return parseTags(tags).join(", ");
}

// The className for a tag chip. Tags are intentionally uncolored — a single
// muted/neutral chip (see .tag in global.css), not a per-name color.
export function tagClass() {
  return "tag";
}

// Home URL filtered to one tag. Clicking a chip anywhere lands here; Home reads
// `?tag` and shows only entries carrying it (see Home.jsx).
export function tagHref(name) {
  return `/?tag=${encodeURIComponent(name)}`;
}
