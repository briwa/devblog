// Build-time remark plugin: turn ```js canvas|svg|d3 fences into live iframe
// figures (see src/lib/sandbox.js for the why of the whole feature).
//
// This file is BUILD-ONLY — it's imported solely by astro.config.mjs and pulls
// in Shiki. The browser-safe pieces (buildSrcdoc, the markdown scanner, the
// escapers) live in sandbox.js, which the editor island imports; keeping Shiki
// out of there is deliberate, so the editor bundle stays lean.
//
// The "show code" half of each figure is highlighted with ASTRO'S OWN Shiki
// highlighter — the same `createShikiHighlighter` (defaulting to the github-dark
// theme) that Astro's rehypeShiki uses for ordinary code blocks — so a sandbox's
// source looks identical to every other code block on the site. We highlight it
// here (rather than letting rehypeShiki do it) because we replace the fence with
// raw HTML before rehype runs, and Shiki consumes the fence `meta` we need.

import { createShikiHighlighter } from '@astrojs/internal-helpers/shiki';
import { parseMeta, buildSrcdoc, escapeAttr, escapeHtml } from './sandbox.js';

// One highlighter for the whole build (creating it loads grammars/themes, so
// it's cached as a promise and shared across every entry and block).
let highlighterPromise;
const getHighlighter = () => (highlighterPromise ??= createShikiHighlighter());

// Highlight `code` as JS into Astro's standard `<pre class="astro-code …">`
// markup. Falls back to a plain (escaped) <pre> if Shiki ever fails, so a build
// never dies over a figure's source view.
async function highlightCode(code) {
  try {
    const hl = await getHighlighter();
    return await hl.codeToHtml(code, 'js');
  } catch {
    return `<pre class="astro-code"><code>${escapeHtml(code)}</code></pre>`;
  }
}

export function remarkSandbox() {
  return async (tree) => {
    // First collect every sandbox fence (with a stable reference to its slot in
    // the parent), then highlight + replace — highlighting is async, so we keep
    // the synchronous walk separate from the awaited work.
    const found = [];
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'code') {
          const spec = parseMeta(child.lang, child.meta);
          if (spec) { found.push({ parent: node, index: i, spec, code: child.value }); continue; }
        }
        walk(child);
      }
    };
    walk(tree);

    await Promise.all(
      found.map(async ({ parent, index, spec, code }) => {
        const srcdoc = escapeAttr(buildSrcdoc(spec, code));
        // Only highlight + ship the source view when the author opted in with the
        // `code` flag; otherwise the figure is preview-only and we skip the work.
        const codeHtml = spec.showCode ? await highlightCode(code) : ''; // matches the site's other blocks
        // Preview (iframe), plus — only when opted in — the highlighted source and
        // a vanilla toggle. Sizing and the preview↔code toggle are wired up once on
        // the entry page (src/pages/posts/[slug]/index.astro).
        const html =
          // --sandbox-h carries the figure's height so the "Show code" view can
          // cap itself to it and scroll, rather than the source expanding the
          // entry's layout past the preview it replaces.
          `<figure class="sandbox" data-mode="preview" data-preset="${spec.preset}" style="--sandbox-h:${spec.h}px">` +
          `<div class="sandbox-stage"><iframe class="sandbox-frame" sandbox="allow-scripts" loading="lazy" title="interactive ${spec.preset} figure" srcdoc="${srcdoc}"></iframe></div>` +
          (spec.showCode
            ? `<div class="sandbox-code">${codeHtml}</div>` +
              `<button class="sandbox-toggle" type="button">Show code</button>`
            : '') +
          `</figure>`;
        parent.children[index] = { type: 'html', value: html };
      })
    );
  };
}
