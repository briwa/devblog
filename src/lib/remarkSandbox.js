import { createShikiHighlighter } from '@astrojs/internal-helpers/shiki';
import { parseMeta, buildSrcdoc, buildVueSrcdoc, sandboxPrelude, sandboxExternals, sandboxVueComponents, safeUrl, escapeAttr, escapeHtml } from './sandbox.js';

let highlighterPromise;
const getHighlighter = () => (highlighterPromise ??= createShikiHighlighter({ theme: 'css-variables' }));

// Falls back to a plain <pre> if Shiki fails, so a build never dies over a figure.
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
    // Collect fences synchronously, then highlight + replace — highlighting is async.
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

    // All blocks, so a figure can pull its own group's lib/external-lib regardless of position.
    const allBlocks = found.map(({ spec, code }) => ({ ...spec, code }));

    await Promise.all(
      found.map(async ({ parent, index, spec, code }) => {
        // A `lib` block renders no figure — just its shared source in a <details>.
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
        // Like `lib`, but reveals the injected URLs as links; invalid ones still show
        // verbatim so a typo never silently disappears.
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
        // Like `lib`, but an SFC shared component; injected into vue figures elsewhere.
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
        // Pull only this figure's group (by id) of shared source + external scripts.
        const externals = sandboxExternals(allBlocks, spec.id);
        const srcdoc = escapeAttr(
          spec.vue
            ? buildVueSrcdoc(spec, code, { externals, components: sandboxVueComponents(allBlocks, spec.id) })
            : buildSrcdoc(spec, code, sandboxPrelude(allBlocks, spec.id), externals)
        );
        const codeHtml = spec.showCode ? await highlightCode(code, spec.vue ? 'vue' : 'js') : '';
        const html =
          // --sandbox-h carries the figure's height so the "Show code" view can cap
          // itself to it rather than expanding the entry's layout past the preview.
          `<figure class="sandbox" data-mode="preview" data-preset="${spec.preset}" style="--sandbox-h:${spec.h}px">` +
          // Not loading="lazy": the toggle hides the stage with display:none, and a
          // lazy iframe would re-fire its load when reshown, discarding the running figure.
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
