// Pure (no astro:content) so the build endpoint and dev mirror share it.
import { firstParagraph } from './publish.js';
import {
  findSandboxBlocks,
  buildSrcdoc,
  buildVueSrcdoc,
  sandboxPrelude,
  sandboxExternals,
  sandboxVueComponents,
} from './sandbox.js';

export const HOME_RECENT = 3;

const IMG_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)/;

function toText(md) {
  return md
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/([*_])([^*_]+)\1/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\s-]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstImage(body) {
  const m = IMG_RE.exec(body);
  if (!m) return null;
  let src = m[2].trim();
  if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
  return { at: m.index, cover: { type: 'image', src, alt: m[1] || '' } };
}

function firstSandbox(body) {
  const blocks = findSandboxBlocks(body);
  const b = blocks.find((x) => x.closed && !x.snippet && !x.external && !x.vueLib);
  if (!b) return null;
  const externals = sandboxExternals(blocks, b.id);
  // hover: a static first frame on the cover that animates while hovered.
  const srcdoc = b.vue
    ? buildVueSrcdoc(b, b.code, { externals, components: sandboxVueComponents(blocks, b.id) })
    : buildSrcdoc({ ...b, hover: true }, b.code, sandboxPrelude(blocks, b.id), externals);
  return { at: b.from, cover: { type: 'sandbox', srcdoc, w: b.w, h: b.h, preset: b.preset } };
}

export function entryPreview(body = '') {
  let excerpt = toText(firstParagraph(body || ''));
  if (excerpt.length > 220) excerpt = excerpt.slice(0, 220).replace(/\s+\S*$/, '') + '…';

  const img = firstImage(body || '');
  const sb = firstSandbox(body || '');
  const cover = img && sb ? (img.at <= sb.at ? img.cover : sb.cover) : (img || sb || {}).cover || null;

  return { excerpt, cover };
}
