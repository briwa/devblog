// Build-time remark plugin: turn ```js canvas|svg fences into live iframe
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
import { parseMeta, buildSrcdoc, buildVueSrcdoc, sandboxPrelude, sandboxExternals, sandboxVueComponents, safeUrl, escapeAttr, escapeHtml } from './sandbox.js';

// One highlighter for the whole build (creating it loads grammars/themes, so
// it's cached as a promise and shared across every entry and block).
let highlighterPromise;
const getHighlighter = () => (highlighterPromise ??= createShikiHighlighter());

// Highlight `code` into Astro's standard `<pre class="astro-code …">` markup,
// defaulting to JS (`vue` source passes lang:'vue'). Falls back to a plain
// (escaped) <pre> if Shiki ever fails — including if the grammar isn't loaded —
// so a build never dies over a figure's source view.
async function highlightCode(code, lang = 'js') {
  try {
    const hl = await getHighlighter();
    return await hl.codeToHtml(code, lang);
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

    // All blocks across the file, so a figure can pull the `lib`/`external-lib`
    // blocks of its OWN group (by `id`, default "") regardless of position. The
    // per-figure prelude/externals are computed inside the loop below.
    const allBlocks = found.map(({ spec, code }) => ({ ...spec, code }));

    await Promise.all(
      found.map(async ({ parent, index, spec, code }) => {
        // A `lib` block renders no figure — just its highlighted source. It's
        // collapsed by default into a Notion-style <details>: a clickable summary
        // row reveals the shared helpers it injects. The summary label is the
        // author's `lib="…"` text, or a default prompt for the bare `lib` form.
        if (spec.snippet) {
          const libHtml = await highlightCode(code);
          const summary = spec.summary || 'Click to see the code';
          parent.children[index] = {
            type: 'html',
            value:
              `<details class="sandbox sandbox-lib">` +
              `<summary><span class="sandbox-lib-tag">lib</span><span class="sandbox-lib-label">${escapeHtml(summary)}</span></summary>` +
              `${libHtml}</details>`,
          };
          return;
        }
        // An `external-lib` block also renders no figure — just the URL(s) it
        // injects into every figure, in the same collapsible <details> shell as
        // `lib` (so the two read alike), but revealing clickable links instead of
        // highlighted source. Valid (https) URLs become links; if none validate,
        // the raw body is shown verbatim so a typo never silently disappears.
        if (spec.external) {
          const urls = (code || '').split(/\s+/).map(safeUrl).filter(Boolean);
          const summary = spec.summary || 'External library';
          const body = urls.length
            ? urls
                .map(
                  (u) =>
                    `<a href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a>`
                )
                .join('')
            : `<span class="sandbox-external-bad">${escapeHtml((code || '').trim())}</span>`;
          parent.children[index] = {
            type: 'html',
            value:
              `<details class="sandbox sandbox-lib sandbox-external">` +
              `<summary><span class="sandbox-lib-tag">external-lib</span><span class="sandbox-lib-label">${escapeHtml(summary)}</span></summary>` +
              `<div class="sandbox-external-urls">${body}</div></details>`,
          };
          return;
        }
        // A `vue lib="Name"` block renders like `lib` — collapsed source in a
        // <details> — but its source is an SFC (highlighted as vue) and the tag
        // marks it as a shared component. It's injected into vue figures of its
        // group by sandboxVueComponents, not here.
        if (spec.vueLib) {
          const libHtml = await highlightCode(code, 'vue');
          const summary = spec.summary || 'Vue component';
          parent.children[index] = {
            type: 'html',
            value:
              `<details class="sandbox sandbox-lib">` +
              `<summary><span class="sandbox-lib-tag">vue lib</span><span class="sandbox-lib-label">${escapeHtml(summary)}</span></summary>` +
              `${libHtml}</details>`,
          };
          return;
        }
        // Pull only this figure's group (by id) of shared lib source + external
        // scripts, so a block tagged `id="x"` reaches only figures tagged `id="x"`.
        // A `vue` figure compiles its SFC in-frame (buildVueSrcdoc) and pulls its
        // group's `vue lib` components; a `js` figure uses the inlined-prelude path.
        const externals = sandboxExternals(allBlocks, spec.id);
        const srcdoc = escapeAttr(
          spec.vue
            ? buildVueSrcdoc(spec, code, { externals, components: sandboxVueComponents(allBlocks, spec.id) })
            : buildSrcdoc(spec, code, sandboxPrelude(allBlocks, spec.id), externals)
        );
        // Only highlight + ship the source view when the author opted in with the
        // `code` flag; otherwise the figure is preview-only and we skip the work.
        const codeHtml = spec.showCode ? await highlightCode(code, spec.vue ? 'vue' : 'js') : ''; // matches the site's other blocks
        // Preview (iframe), plus — only when opted in — the highlighted source and
        // a vanilla toggle. Sizing and the preview↔code toggle are wired up once on
        // the entry page (src/pages/posts/[slug]/index.astro).
        const html =
          // --sandbox-h carries the figure's height so the "Show code" view can
          // cap itself to it and scroll, rather than the source expanding the
          // entry's layout past the preview it replaces.
          `<figure class="sandbox" data-mode="preview" data-preset="${spec.preset}" style="--sandbox-h:${spec.h}px">` +
          // NOT loading="lazy": the "Show code" toggle hides the stage with
          // display:none, and a lazy iframe re-fires its load when shown again —
          // which throws away the running figure (a played canvas resets to its
          // paused play-button state, an animation restarts). Eager keeps the
          // frame's browsing context alive across the toggle so it's a pure
          // show/hide. These are tiny srcdoc frames, so eager load is cheap.
          `<div class="sandbox-stage"><iframe class="sandbox-frame" sandbox="allow-scripts" title="interactive ${spec.preset} figure" srcdoc="${srcdoc}"></iframe></div>` +
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
