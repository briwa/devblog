// Single source of truth for tag normalization; the comma is the only separator (spaces allowed within a tag).
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

export function serializeTags(tags) {
  return parseTags(tags).join(", ");
}

export function tagHref(name) {
  return `/archive?tag=${encodeURIComponent(name)}`;
}
