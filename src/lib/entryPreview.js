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

const IMG_RE = /!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)([^)]*)\)/g;
// An image opts in as the cover with a `"preview"` title: ![alt](src "preview").
const PREVIEW_TITLE = /^\s*["']preview["']\s*$/;

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

// Candidates keep a lazy `make()` so we only build the srcdoc of the one we pick.
function imageCandidates(body) {
  const out = [];
  IMG_RE.lastIndex = 0;
  for (let m; (m = IMG_RE.exec(body)); ) {
    let src = m[2].trim();
    if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
    const alt = m[1] || '';
    out.push({ at: m.index, preview: PREVIEW_TITLE.test(m[3] || ''), make: () => ({ type: 'image', src, alt }) });
  }
  return out;
}

function sandboxCandidates(body) {
  const blocks = findSandboxBlocks(body);
  return blocks
    .filter((b) => b.closed && !b.snippet && !b.external && !b.vueLib)
    .map((b) => ({
      at: b.from,
      preview: !!b.preview,
      make: () => {
        const externals = sandboxExternals(blocks, b.id);
        // hover: a static first frame on the cover that animates while hovered.
        const srcdoc = b.vue
          ? buildVueSrcdoc(b, b.code, { externals, components: sandboxVueComponents(blocks, b.id) })
          : buildSrcdoc({ ...b, hover: true }, b.code, sandboxPrelude(blocks, b.id), externals);
        return { type: 'sandbox', srcdoc, w: b.w, h: b.h, preset: b.preset };
      },
    }));
}

// A `preview`-tagged figure/image wins; absent any, fall back to the first one in the entry.
function pickCover(body) {
  const all = [...imageCandidates(body), ...sandboxCandidates(body)];
  if (!all.length) return null;
  const tagged = all.filter((c) => c.preview);
  const pool = tagged.length ? tagged : all;
  const chosen = pool.reduce((a, b) => (a.at <= b.at ? a : b));
  return chosen.make();
}

export function entryPreview(body = '') {
  let excerpt = toText(firstParagraph(body || ''));
  if (excerpt.length > 220) excerpt = excerpt.slice(0, 220).replace(/\s+\S*$/, '') + '…';

  return { excerpt, cover: pickCover(body || '') };
}
