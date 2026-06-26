// Interactive figure sandboxes.
//
// A fenced code block whose info string is `js <preset>` (optionally with a
// `WxH` size) is turned into a live, runnable figure embedded in the post:
//
//     ```js canvas        → 2D canvas, exposes `canvas`, `ctx`, `width`, `height`
//     ```js svg 800x500   → an <svg> root, exposes `svg`, `width`, `height`
//     ```js root          → a sized <div id="root">, exposes `root`, `width`, `height`
//
// The `root` preset is for libraries that want to OWN a container element (Konva,
// Pts, Pixi, …): they take `root` (the element) or `'#root'` (the selector) and
// append their own canvas/svg into it — no per-figure "make a div" boilerplate.
//
// Need a library like d3? Load it with an `external-lib` block (see parseMeta) —
// e.g. a CDN URL for d3 — and use it from an `svg` or `root` figure. There's no
// built-in library preset: the sandbox stays dependency-free and any CDN works.
//
// Append the bare token `code` (e.g. ```js svg code) to expose a "Show code"
// toggle on the published figure; without it the figure is preview-only.
//
// Append `bg="<color>"` (e.g. ```js canvas bg="#111") to paint the figure's
// background a specific color instead of inheriting the theme (quotes required).
// The play overlay (canvas figures) auto-picks a contrasting palette for it.
//
// WHY a fenced code block (not a custom `<sandbox>` tag): markdown preserves a
// fence's contents *verbatim* — blank lines, `<`, `>`, `&` all survive — whereas
// a raw-HTML block ends at the first blank line and would shred any real snippet.
// It also hands us the source text for free, which becomes the "show code" view.
//
// WHY an iframe (`srcdoc`, `sandbox="allow-scripts"`, no `allow-same-origin`):
// each figure gets its own disposable realm. That buys two things this site
// actually needs — its own global scope (so two figures don't collide on
// `const width = …`) and clean teardown of `requestAnimationFrame`/`setInterval`
// loops (removing the frame kills them). The null origin is a bonus: a figure
// can't reach the authenticated `/api/*` endpoints with the owner's cookie.
//
// This is a remark plugin (operates on the markdown AST) rather than rehype so we
// can read the fence's `lang`/`meta` directly and swap the node out *before*
// Shiki runs — Shiki then only highlights the ordinary code blocks we leave alone.

// Which presets exist, and what each pre-exposes to the authored code.
const PRESETS = new Set(['canvas', 'svg', 'root']);
const DEFAULT_W = 640;
const DEFAULT_H = 360;

// `vue` figures load these inside the frame: the Vue 3 RUNTIME global build (no
// template compiler — vue3-sfc-loader does the compiling) and the loader itself,
// which compiles `.vue` SFC source in-browser. Auto-injected (unlike a generic
// `external-lib`) because a `vue` block is meaningless without them — they're the
// language's runtime, not an optional library choice. See buildVueSrcdoc.
const VUE_SRC = 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.runtime.global.prod.js';
const SFC_LOADER_SRC = 'https://cdn.jsdelivr.net/npm/vue3-sfc-loader@0.9/dist/vue3-sfc-loader.js';

// Escape text for use inside a double-quoted HTML attribute (the `srcdoc`).
// We escape `&` and `"` only: that's sufficient to reproduce the inner document
// faithfully once the browser entity-decodes the attribute. `<`/`>` are left as
// literals (legal inside a quoted attribute value) so our own <script>/<canvas>
// wrapper tags parse correctly on the other side. The one thing authored code
// must therefore avoid is a literal `</script>` — a non-issue for drawing code.
export const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Escape text shown as a plain-text fallback in the "code" view (when Shiki
// highlighting is unavailable). The normal path is highlighted — see
// src/lib/remarkSandbox.js.
export const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Parse a fence info string's meta (everything after `js`) into a preset + size.
// Returns null if it isn't a sandbox block, so ordinary ```js blocks pass through.
export function parseMeta(lang, meta) {
  // `vue` is a second language (alongside `js`): the fence body is Vue 3 Single-
  // File-Component source, compiled in-frame by vue3-sfc-loader (see buildVueSrcdoc).
  const isVue = lang === 'vue';
  if (lang !== 'js' && lang !== 'javascript' && !isVue) return null;
  const raw = (meta || '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const preset = tokens.find((t) => PRESETS.has(t));
  // Optional `id="<group>"` partitions a file's blocks into groups: a figure only
  // receives the `lib`/`external-lib` blocks that share its id (see sandboxPrelude
  // /sandboxExternals). An absent id is itself a group (the default, ""), so a file
  // with no ids shares everything file-wide as before — this is purely additive.
  // Use it to scope a heavy `external-lib` (e.g. Vue) to the one figure that needs
  // it instead of injecting it into every frame. Quoted like `bg`/`lib`; restricted
  // to a safe identifier charset (a stray value can't leak anywhere, but keep it
  // clean), falling back to the default group when malformed.
  const idMatch = /(?:^|\s)id="([^"]*)"/.exec(raw);
  let id = idMatch ? idMatch[1] : '';
  if (id && !/^[\w-]+$/.test(id)) id = '';

  if (isVue) {
    // A `vue lib="Name"` block is a shared COMPONENT, not a figure: it renders no
    // iframe (just its highlighted source in a <details>, like `lib`), and its SFC
    // is registered as global component `Name` in every vue figure of its group
    // (by id). The quoted value is both the registered name and the <details>
    // label; require a valid component identifier or it can't be registered.
    const libMatch = /(?:^|\s)lib="([^"]*)"/.exec(raw);
    if (libMatch || tokens.some((t) => t === 'lib' || t.startsWith('lib='))) {
      let name = libMatch ? libMatch[1] : '';
      if (name && !/^[A-Za-z][\w-]*$/.test(name)) name = '';
      return { vue: true, vueLib: true, componentName: name, summary: name, id };
    }
    // Otherwise it's a vue figure: the SFC mounts into the `#root` div. Reuses the
    // `root` surface (sizing/scaling), the `WxH`/`bg`/`code` tokens, and the `id`
    // group. No play-button deferral — a Vue app is interactive on load, and the
    // loader is async, so it always runs on load (no `auto` needed).
    const vsize = tokens.find((t) => /^\d+x\d+$/.test(t));
    const [vw, vh] = vsize ? vsize.split('x').map(Number) : [DEFAULT_W, DEFAULT_H];
    const vbgMatch = /(?:^|\s)bg="([^"]*)"/.exec(raw);
    let vbg = vbgMatch ? vbgMatch[1] : '';
    if (vbg && !/^[#\w(),.%\s-]+$/.test(vbg)) vbg = '';
    return { vue: true, preset: 'root', w: vw, h: vh, showCode: tokens.includes('code'), bg: vbg, id };
  }
  // A `lib` block isn't a figure: it renders no iframe, just its source. Its code
  // is concatenated into EVERY figure in the same file as a shared prelude (see
  // sandboxPrelude + buildSrcdoc), so helpers/consts written once are available to
  // all figures. It renders as a collapsible <details> (see remarkSandbox.js). The
  // summary label is set ONLY by the quoted `lib="…"` form; bare `lib` — or a
  // mistakenly unquoted `lib=foo` — falls back to the default prompt. Requiring
  // quotes keeps `lib` and `bg` consistent and sidesteps ambiguity over spaces. The
  // value is pulled from the RAW meta (not the whitespace-split tokens) so a summary
  // with spaces survives. Recognized only when NO preset is present: a real preset
  // means the block is a figure, and a stray `lib` token there is ignored rather
  // than silently turning the figure into a snippet.
  // An `external-lib` block is, like `lib`, shared code rather than a figure —
  // but its body is one or more URLs (one per line / whitespace-separated), not
  // source. Each URL is injected as a classic `<script src="…">` into EVERY
  // figure in the file (see sandboxExternals + buildSrcdoc), as a classic
  // `<script src>` — so a library hosted on a CDN (jsDelivr, a raw-gist proxy, …),
  // d3 included, is in scope for all figures. Unlike `lib`, nothing is
  // inlined: this is a runtime fetch by the frame, so the figure now depends on
  // that URL staying reachable (the trade-off vs. an inlined `lib` block). It
  // renders as a collapsible <details> like `lib`, but reveals the URL(s) rather
  // than highlighted code. Checked BEFORE `lib` so the `external-lib` token isn't
  // mistaken for a bare `lib`. The optional quoted `external-lib="…"` sets the
  // summary label (matching `lib="…"`); bare `external-lib` falls back to default.
  if (!preset && tokens.some((t) => t === 'external-lib' || t.startsWith('external-lib='))) {
    const m = /(?:^|\s)external-lib="([^"]*)"/.exec(raw);
    return { external: true, summary: m ? m[1] : '', id };
  }
  if (!preset && tokens.some((t) => t === 'lib' || t.startsWith('lib='))) {
    const m = /(?:^|\s)lib="([^"]*)"/.exec(raw);
    return { snippet: true, summary: m ? m[1] : '', id };
  }
  if (!preset) return null;
  const size = tokens.find((t) => /^\d+x\d+$/.test(t));
  const [w, h] = size ? size.split('x').map(Number) : [DEFAULT_W, DEFAULT_H];
  // Opt-in: a bare `code` token makes the published figure offer a "Show code"
  // toggle. Off by default — a figure is just its running result unless the
  // author explicitly wants to expose its source.
  const showCode = tokens.includes('code');
  // Opt-in: a bare `auto` token makes a canvas figure run on load instead of
  // opening paused behind a play button. Default stays deferred (play button) so
  // animations don't burn rAF until the reader asks for them; `auto` is for the
  // rare figure that should be moving the moment it scrolls into view. No effect
  // on svg, which already runs on load.
  const auto = tokens.includes('auto');
  // Optional `bg="<color>"` paints the figure body. Quotes are REQUIRED (matching
  // `lib="…"`); an unquoted `bg=#111` is ignored and the figure keeps the theme
  // background, so there's no ambiguity over which forms take a value. Quoting also
  // lets the value carry spaces (e.g. `bg="rgb(20, 20, 20)"`). hex (`#111`), named
  // colors (`black`) and functional forms all work. Restrict to a safe CSS-color
  // charset so a stray token can't break out of the style/attribute it lands in.
  const bgMatch = /(?:^|\s)bg="([^"]*)"/.exec(raw);
  let bg = bgMatch ? bgMatch[1] : '';
  if (bg && !/^[#\w(),.%\s-]+$/.test(bg)) bg = '';
  return { preset, w, h, showCode, bg, auto, id };
}

// Concatenate the `lib` blocks of one group into a shared prelude string. Given a
// list of parsed blocks (each carrying `snippet` + `code` + `id`, in document
// order) and the consuming figure's group id, returns the source prepended into
// that figure's frame — only blocks whose id matches (default group is ""). The
// iframes can't share globals at runtime (separate null-origin realms), so sharing
// is done here by composing source text — each frame gets its own private copy of
// the helpers, written once by the author. Blank if the group has no lib blocks.
export function sandboxPrelude(blocks, groupId = '') {
  return (blocks || [])
    .filter((b) => b.snippet && (b.id || '') === (groupId || ''))
    .map((b) => b.code)
    .join('\n\n');
}

// Validate a URL destined for a figure's `<script src="…">`. Returns the URL if
// it's safe to drop into that attribute, '' otherwise. We require https:// (no
// http/protocol-relative/data:, so a figure can't be silently downgraded) and
// reject any char that could break out of the double-quoted attribute or the
// surrounding tag — `"`, `<`, `>`, quotes, whitespace. The whole-document
// escapeAttr pass (remark path) only escapes `&`/`"`, so a literal `"` here would
// still split the attribute after decode; rejecting it outright is simpler and
// safer. Same charset-restriction posture as `bg` in parseMeta.
export function safeUrl(u) {
  const s = (u || '').trim();
  if (!s.startsWith('https://')) return '';
  if (/["'<>\s]/.test(s)) return '';
  return s;
}

// Collect one group's `external-lib` URL(s), in document order, as a flat list of
// validated https URLs — only blocks whose id matches the consuming figure's group
// (default ""). Each becomes a `<script src>` injected into that figure
// (buildSrcdoc), loaded before the figure's own code. Invalid URLs are dropped
// (the <details> rendering still shows the author what they typed). Mirrors
// sandboxPrelude, but for external scripts rather than inlined source.
export function sandboxExternals(blocks, groupId = '') {
  return (blocks || [])
    .filter((b) => b.external && (b.id || '') === (groupId || ''))
    .flatMap((b) => (b.code || '').split(/\s+/))
    .map(safeUrl)
    .filter(Boolean);
}

// Collect one group's `vue lib="Name"` components — { name, code } in document
// order, only blocks whose id matches the consuming vue figure's group (default
// ""). Each is served to vue3-sfc-loader as a virtual `/<Name>.vue` file and
// registered as global component `Name` (buildVueSrcdoc), so a figure's template
// can use `<Name>` / `<name>` without importing. Named, valid components only.
export function sandboxVueComponents(blocks, groupId = '') {
  return (blocks || [])
    .filter((b) => b.vueLib && b.componentName && (b.id || '') === (groupId || ''))
    .map((b) => ({ name: b.componentName, code: b.code }));
}

// Escape a string for embedding inside a JS template literal (backtick string).
// Used to inline SFC source into the frame's script as data for the loader: we
// escape `\`, backtick and `${` so the source can't break out of or interpolate
// into the literal, and `</script>` (case-insensitively) so it can't close the
// frame's <script> wrapper — `<\/script>` reads back as `</script>` at runtime,
// which is what the loader must see, while the HTML parser never sees the token.
export const escapeTemplate = (s) =>
  '`' +
  String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/<\/script>/gi, '<\\/script>') +
  '`';

// Build the inner document for a `vue` figure: load Vue + vue3-sfc-loader, hand the
// loader the SFC source (main + every group `vue lib` component) as virtual files,
// register the lib components globally, then mount the main SFC into `#root`. The
// loader compiles `<template>`/`<script setup>`/`<style scoped>` in-frame, so full
// SFC syntax works with no build step. `externals` (the group's `external-lib`
// URLs) are injected too, before Vue, so a component can use other CDN globals.
// Async (the loader returns promises); a throw renders its stack into the frame.
export function buildVueSrcdoc({ w, h, bg }, code, { externals = [], components = [] } = {}) {
  const ext = (externals || []).map((u) => `<script src="${u}"></script>`).join('');
  const bgCss = bg ? `body{background:${bg}}` : '';
  const rootCss = `#root{position:relative;width:${w}px;height:${h}px;max-width:100%}`;
  const css = `html,body{margin:0}${bgCss}${rootCss}canvas,svg{display:block;max-width:100%;height:auto}.err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}`;

  // Virtual filesystem the loader reads from: each group component as /<Name>.vue
  // plus the figure's own SFC as /__main__.vue. Sources are embedded as template
  // literals (escapeTemplate) so any `</script>`/backticks inside survive.
  const files = [
    ...components.map((c) => `${JSON.stringify('/' + c.name + '.vue')}:${escapeTemplate(c.code)}`),
    `${JSON.stringify('/__main__.vue')}:${escapeTemplate(code)}`,
  ].join(',');
  // Register each group component globally before mount, so templates can use it.
  const regs = components
    .map((c) => `app.component(${JSON.stringify(c.name)},await loadModule(${JSON.stringify('/' + c.name + '.vue')},opts));`)
    .join('');

  const script =
    `const root=document.querySelector('#root');` +
    `const report=()=>parent.postMessage({__sandboxHeight:document.documentElement.scrollHeight},'*');` +
    `new ResizeObserver(report).observe(document.documentElement);` +
    `const __files={${files}};` +
    `const opts={moduleCache:{vue:Vue},getFile(u){const f=__files[u];if(f==null)throw new Error('file not found: '+u);return Promise.resolve(f)},addStyle(t){const s=document.createElement('style');s.textContent=t;document.head.appendChild(s)}};` +
    `const {loadModule}=window['vue3-sfc-loader'];` +
    `(async()=>{try{const app=Vue.createApp(await loadModule('/__main__.vue',opts));${regs}app.mount(root)}catch(e){document.body.innerHTML='<pre class=err>'+(e&&e.stack||e)+'</pre>'}report()})();`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div>${ext}<script src="${VUE_SRC}"></script><script src="${SFC_LOADER_SRC}"></script><script>${script}</script></body></html>`;
}

// Build the inner document for one figure. `code` is the author's verbatim JS;
// `prelude` is the shared `lib` source (sandboxPrelude) prepended before it.
// Returns the RAW document string. The remark plugin escapes it for an HTML
// attribute (escapeAttr); the editor's live preview passes it straight to a
// React `srcDoc` prop, which does its own escaping — so escaping here would
// double-encode. Keep this function attribute-agnostic.
export function buildSrcdoc({ preset, w, h, bg, auto }, code, prelude = '', externals = []) {
  const isCanvas = preset === 'canvas';
  // The surface element and the bindings handed to the authored code. The emitted
  // boilerplate below is written TERSE on purpose — this whole string is inlined
  // into every figure's `srcdoc`, so its comments/indentation would ship verbatim
  // into the built HTML. The explanations therefore live out here as JS comments;
  // only the authored `code`/`prelude` (which the author controls) keep their own
  // formatting, so a thrown error's stack line stays meaningful.
  // `root` is a bare, sized <div id="root"> mount point — no drawing surface of
  // its own. It exists so a library that wants to OWN a container element (Konva,
  // Pts, Pixi, …) can just take `root` (the element) or `'#root'` (the selector),
  // instead of every such figure hand-rolling the "replace the canvas with a div"
  // boilerplate. The library appends its own canvas/svg into it; those inherit the
  // `max-width:100%` rule below and scale like the native presets.
  const isRoot = preset === 'root';
  const surface = isCanvas
    ? '<canvas></canvas>'
    : isRoot
      ? '<div id="root"></div>'
      : `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const setup = isCanvas
    ? `const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),width=canvas.width=${w},height=canvas.height=${h};`
    : isRoot
      ? `const root=document.querySelector('#root'),width=${w},height=${h};`
      : `const svg=document.querySelector('svg'),width=${w},height=${h};`;
  // `external-lib` URLs: classic `<script src>` tags emitted before the author's
  // inline script, so each loads and runs (defining its globals on `window`)
  // before the figure's code does — same ordering guarantee a classic script
  // gives. URLs are pre-validated by sandboxExternals/safeUrl, so they're safe to
  // interpolate here.
  const ext = (externals || []).map((u) => `<script src="${u}"></script>`).join('');

  // A canvas (or root) figure typically animates — via loop(), or a library's own
  // ticker mounted into root — and shouldn't burn rAF the moment the page loads.
  // So by default it opens PAUSED behind a centered, YouTube-style play button and
  // runs only on click. The `auto` token opts it into running on load instead. svg
  // figures are typically a single static draw, so they run on load regardless. The
  // button lives INSIDE the frame (not as a host overlay) so the deferral behaves
  // identically on the published page and in the editor's live preview, both of
  // which share this one srcdoc — no extra host JS, no cross-frame "start" message.
  // The empty surface placeholder reports its height just like a drawn one, so the
  // frame is already sized to center the button in.
  const deferred = (isCanvas || isRoot) && !auto;
  const playBtn = deferred
    ? `<button id="__play" type="button" aria-label="Run figure"><svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true"><polygon points="38,28 38,72 74,50" fill="currentColor"/></svg></button>`
    : '';
  // Only canvas frames carry the play overlay, so only they need its CSS — keep
  // the svg frames free of dead rules. inset:0 + margin:auto centers the button
  // over the (unpositioned) body, which fills the frame = the canvas box. The
  // default dark translucent fill reads on light/transparent backgrounds; the
  // `.on-dark` variant (applied at runtime when the background is dark — see
  // below) flips to a light fill with a dark icon so the button always contrasts.
  // The triangle is nudged right so it looks optically centered in the circle.
  const playCss = deferred
    ? `#__play{position:absolute;inset:0;margin:auto;width:64px;height:64px;border:0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,20,.55);transition:background .15s,transform .15s}#__play:hover{background:rgba(20,20,20,.8);transform:scale(1.06)}#__play.on-dark{color:#111;background:rgba(245,245,245,.6)}#__play.on-dark:hover{background:rgba(245,245,245,.85)}`
    : '';

  // A custom figure background, if requested. Painted on the body so it sits
  // behind the canvas/svg surface; without it the body is transparent and the
  // frame shows the theme background (.sandbox-frame's var(--bg)) as before.
  const bgCss = bg ? `body{background:${bg}}` : '';

  // Size the `root` div to the figure's WxH so a mounted library has real
  // dimensions to read and the deferred play button has a box to center in.
  // position:relative anchors any absolutely-positioned children the library adds;
  // max-width:100% keeps it from overflowing the frame on a narrow column (its
  // inner canvas/svg still scales via the rule below).
  const rootCss = isRoot ? `#root{position:relative;width:${w}px;height:${h}px;max-width:100%}` : '';

  const css = `html,body{margin:0}${bgCss}${rootCss}canvas,svg{display:block;max-width:100%;height:auto}.err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}${playCss}`;

  // loop(): a self-cancelling rAF helper so authored animation loops are easy to
  //   write and die with the frame — runs fn every frame, returns a stop().
  // report(): tells the parent our content height so it can size the (otherwise
  //   unsized) iframe; a ResizeObserver re-reports on every reflow.
  // run(): the authored prelude + code, wrapped so a throw renders its stack into
  //   the frame. The shared `lib` prelude runs first, in the same try/catch (a
  //   broken helper surfaces too) and the same scope (its consts are visible to the
  //   figure's code). prelude/code sit on their own lines so a trailing `//` in the
  //   author's source can't comment out the closing brace.
  const script =
    setup +
    `const loop=(fn)=>{let id;const t=(ts)=>{fn(ts);id=requestAnimationFrame(t)};id=requestAnimationFrame(t);return ()=>cancelAnimationFrame(id)};` +
    `const report=()=>parent.postMessage({__sandboxHeight:document.documentElement.scrollHeight},'*');` +
    `new ResizeObserver(report).observe(document.documentElement);` +
    `const run=()=>{try{\n${prelude}\n${code}\n}catch(e){document.body.innerHTML='<pre class=err>'+(e&&e.stack||e)+'</pre>'}report()};` +
    // Deferred (canvas) figures wait for a click; others run on load. For the
    // deferred case, give the play button a palette that contrasts with whatever
    // the figure renders behind it: read the body's COMPUTED background and switch
    // to the light-on-dark variant when it's dark and opaque. Reading the computed
    // value works for any CSS color (named/hex/rgb/hsl) without parsing it.
    (deferred
      ? `const __play=document.getElementById('__play'),__c=getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);if(__c&&(__c.length<4||+__c[3]>0)&&(0.299*__c[0]+0.587*__c[1]+0.114*__c[2])<128)__play.classList.add('on-dark');__play.addEventListener('click',()=>{__play.remove();run()});report();`
      : `run();`);

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${surface}${playBtn}${ext}<script>${script}</script></body></html>`;
}

// Scan raw markdown for sandbox fences, returning, in document order,
// { preset, w, h, code, from, to, closed } — `from`/`to` are character offsets
// of the whole block (opening fence line start → closing fence line end) and
// `closed` is whether a closing fence was found. Used by the editor's inline
// preview, which works on raw source text (not the parsed AST the remark plugin
// sees) and needs offsets to place its decorations. Pragmatic line-scanner —
// handles ``` / ~~~ fences, enough for hand-authored entries.
export function findSandboxBlocks(src) {
  const text = src || '';
  const lines = text.split('\n');
  // Char offset at the start of each line, so we can report block ranges.
  const starts = [];
  for (let p = 0, k = 0; k < lines.length; k++) { starts.push(p); p += lines[k].length + 1; }

  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s*(`{3,}|~{3,})\s*([^\s]+)?\s*(.*)$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[1][0]; // ` or ~
    const spec = parseMeta(open[2] || '', open[3] || '');
    // Collect the body until the matching closing fence regardless of whether
    // this block is a sandbox, so a non-sandbox fence doesn't desync the scan.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (new RegExp(`^\\s*\\${fence}{3,}\\s*$`).test(lines[j])) break;
      body.push(lines[j]);
    }
    const closed = j < lines.length;
    if (spec) {
      const endLine = closed ? j : lines.length - 1;
      const to = Math.min(text.length, starts[endLine] + lines[endLine].length);
      blocks.push({ ...spec, code: body.join('\n'), from: starts[i], to, closed });
    }
    i = j; // resume after the closing fence
  }
  return blocks;
}
