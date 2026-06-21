// Interactive figure sandboxes: a `js`/`vue` fence becomes a live iframe figure.
//
// WHY a fenced code block: markdown preserves a fence's contents verbatim, whereas a
// raw-HTML block ends at the first blank line and would shred a real snippet.
// WHY an iframe (srcdoc, sandbox="allow-scripts", no allow-same-origin): each figure
// gets its own disposable realm — isolated globals, clean rAF/setInterval teardown, null origin.
// A remark plugin (not rehype) so it reads the fence's lang/meta and swaps the node before Shiki runs.

const PRESETS = new Set(['canvas', 'svg', 'root']);
const DEFAULT_W = 640;
const DEFAULT_H = 360;

// Vue runtime + SFC loader, auto-injected into every `vue` frame (the language's runtime, not an optional lib).
const VUE_SRC = 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.runtime.global.prod.js';
const SFC_LOADER_SRC = 'https://cdn.jsdelivr.net/npm/vue3-sfc-loader@0.9/dist/vue3-sfc-loader.js';

// Escape for a double-quoted srcdoc attribute: only &/" (leaving </> literal so our wrapper tags parse).
export const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Parse a fence's meta into a preset + size; null when it isn't a sandbox block (ordinary ```js passes through).
export function parseMeta(lang, meta) {
  const isVue = lang === 'vue';
  if (lang !== 'js' && lang !== 'javascript' && !isVue) return null;
  const raw = (meta || '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const preset = tokens.find((t) => PRESETS.has(t));
  // Optional `id="<group>"` partitions blocks into groups; absent id is the default group "".
  const idMatch = /(?:^|\s)id="([^"]*)"/.exec(raw);
  let id = idMatch ? idMatch[1] : '';
  if (id && !/^[\w-]+$/.test(id)) id = '';

  if (isVue) {
    // A `vue lib="Name"` block is a shared component, not a figure; require a valid identifier to register it.
    const libMatch = /(?:^|\s)lib="([^"]*)"/.exec(raw);
    if (libMatch || tokens.some((t) => t === 'lib' || t.startsWith('lib='))) {
      let name = libMatch ? libMatch[1] : '';
      if (name && !/^[A-Za-z][\w-]*$/.test(name)) name = '';
      return { vue: true, vueLib: true, componentName: name, summary: name, id };
    }
    // A vue figure mounts the SFC into #root; no play-button deferral — Vue is interactive on load.
    const vsize = tokens.find((t) => /^\d+x\d+$/.test(t));
    const [vw, vh] = vsize ? vsize.split('x').map(Number) : [DEFAULT_W, DEFAULT_H];
    const vbgMatch = /(?:^|\s)bg="([^"]*)"/.exec(raw);
    let vbg = vbgMatch ? vbgMatch[1] : '';
    if (vbg && !/^[#\w(),.%\s-]+$/.test(vbg)) vbg = '';
    return { vue: true, preset: 'root', w: vw, h: vh, showCode: tokens.includes('code'), bg: vbg, id };
  }
  // `external-lib` (shared URLs, not a figure); checked before `lib` so its token isn't read as a bare `lib`.
  if (!preset && tokens.some((t) => t === 'external-lib' || t.startsWith('external-lib='))) {
    const m = /(?:^|\s)external-lib="([^"]*)"/.exec(raw);
    return { external: true, summary: m ? m[1] : '', id };
  }
  // A `lib` block is shared source (concatenated into every figure), not a figure; recognized only when no preset.
  if (!preset && tokens.some((t) => t === 'lib' || t.startsWith('lib='))) {
    const m = /(?:^|\s)lib="([^"]*)"/.exec(raw);
    return { snippet: true, summary: m ? m[1] : '', id };
  }
  if (!preset) return null;
  const size = tokens.find((t) => /^\d+x\d+$/.test(t));
  const [w, h] = size ? size.split('x').map(Number) : [DEFAULT_W, DEFAULT_H];
  // Opt-in `code` token: expose a "Show code" toggle (off by default).
  const showCode = tokens.includes('code');
  // Opt-in `auto` token: run on load instead of deferring behind a play button (which spares rAF until asked).
  const auto = tokens.includes('auto');
  // Optional `bg="<color>"` (quotes required); charset-restricted so it can't break out of the style attribute.
  const bgMatch = /(?:^|\s)bg="([^"]*)"/.exec(raw);
  let bg = bgMatch ? bgMatch[1] : '';
  if (bg && !/^[#\w(),.%\s-]+$/.test(bg)) bg = '';
  return { preset, w, h, showCode, bg, auto, id };
}

// Concatenate a group's `lib` blocks into a shared prelude — iframes can't share globals, so sharing is source-level.
export function sandboxPrelude(blocks, groupId = '') {
  return (blocks || [])
    .filter((b) => b.snippet && (b.id || '') === (groupId || ''))
    .map((b) => b.code)
    .join('\n\n');
}

// Validate a URL for a figure's `<script src>`: https-only, no attribute-breaking chars, public explicit `.js` only — else ''.
export function safeUrl(u) {
  const s = (u || '').trim();
  if (!s.startsWith('https://')) return '';
  if (/["'<>\s]/.test(s)) return '';
  let url;
  try { url = new URL(s); } catch { return ''; }
  if (url.username || url.password) return '';
  if (url.search || url.hash) return '';
  if (!/\.js$/i.test(url.pathname)) return '';
  return s;
}

// Raw-GitHub serves .js as nosniff text/plain (won't run as <script src>), so callers fetch-then-inject these instead.
export function isRawGistUrl(u) {
  try {
    const { hostname } = new URL(u);
    return hostname === 'gist.githubusercontent.com' || hostname === 'raw.githubusercontent.com';
  } catch {
    return false;
  }
}

// Collect a group's validated `external-lib` URLs (invalid dropped); injected as <script src> before the figure's code.
export function sandboxExternals(blocks, groupId = '') {
  return (blocks || [])
    .filter((b) => b.external && (b.id || '') === (groupId || ''))
    .flatMap((b) => (b.code || '').split(/\s+/))
    .map(safeUrl)
    .filter(Boolean);
}

// Collect a group's `vue lib="Name"` components as { name, code }, registered globally so templates can use them.
export function sandboxVueComponents(blocks, groupId = '') {
  return (blocks || [])
    .filter((b) => b.vueLib && b.componentName && (b.id || '') === (groupId || ''))
    .map((b) => ({ name: b.componentName, code: b.code }));
}

// Escape a string for a JS template literal so embedded SFC source can't break out or close the <script> wrapper.
export const escapeTemplate = (s) =>
  '`' +
  String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/<\/script>/gi, '<\\/script>') +
  '`';

// Build the inner document for a `vue` figure: compile the SFC in-frame with vue3-sfc-loader and mount into #root.
export function buildVueSrcdoc({ w, h, bg }, code, { externals = [], components = [] } = {}) {
  // Raw-GitHub URLs can't load as <script src> (nosniff), so fetch-then-inject them before the SFC compiles.
  const fetched = (externals || []).filter(isRawGistUrl);
  const ext = (externals || [])
    .filter((u) => !isRawGistUrl(u))
    .map((u) => `<script src="${u}"></script>`)
    .join('');
  const bgCss = bg ? `body{background:${bg}}` : '';
  const rootCss = `#root{position:relative;width:${w}px;height:${h}px;max-width:100%}`;
  const css = `html,body{margin:0}${bgCss}${rootCss}canvas,svg{display:block;max-width:100%;height:auto}.err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}`;

  // Virtual FS the loader reads: group components + the figure's SFC, embedded via escapeTemplate so </script> survives.
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
    (fetched.length
      ? `const __fx=[${fetched.map((u) => JSON.stringify(u)).join(',')}];` +
        `const __loadExt=async()=>{for(const u of __fx){const r=await fetch(u);if(!r.ok)throw new Error('external-lib '+u+' failed: HTTP '+r.status);const s=document.createElement('script');s.textContent=await r.text();document.head.appendChild(s)}};`
      : `const __loadExt=async()=>{};`) +
    `(async()=>{try{await __loadExt();const app=Vue.createApp(await loadModule('/__main__.vue',opts));${regs}app.mount(root)}catch(e){document.body.innerHTML='<pre class=err>'+(e&&e.stack||e)+'</pre>'}report()})();`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div>${ext}<script src="${VUE_SRC}"></script><script src="${SFC_LOADER_SRC}"></script><script>${script}</script></body></html>`;
}

// Build one figure's inner document. Returns the RAW string (callers escape it) — keep attribute-agnostic, or it double-encodes.
export function buildSrcdoc({ preset, w, h, bg, auto }, code, prelude = '', externals = []) {
  const isCanvas = preset === 'canvas';
  // The emitted boilerplate is TERSE on purpose — it's inlined into every srcdoc, so its comments/indentation would ship verbatim.
  // `root` is a bare sized mount point so a container-owning library (Konva, Pts, Pixi) can take it directly.
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
  // `external-lib` URLs as <script src> before the author's code (for ordering); raw-GitHub URLs split off for fetch-inject.
  const fetched = (externals || []).filter(isRawGistUrl);
  const ext = (externals || [])
    .filter((u) => !isRawGistUrl(u))
    .map((u) => `<script src="${u}"></script>`)
    .join('');

  // canvas/root default to PAUSED behind an in-frame play button (spares rAF, and behaves identically on page + editor preview).
  const deferred = (isCanvas || isRoot) && !auto;
  const playBtn = deferred
    ? `<button id="__play" type="button" aria-label="Run figure"><svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true"><polygon points="38,28 38,72 74,50" fill="currentColor"/></svg></button>`
    : '';
  // Play-overlay CSS, only when deferred; the runtime `.on-dark` variant flips fill/icon so the button always contrasts.
  const playCss = deferred
    ? `#__play{position:absolute;inset:0;margin:auto;width:64px;height:64px;border:0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,20,.55);transition:background .15s,transform .15s}#__play:hover{background:rgba(20,20,20,.8);transform:scale(1.06)}#__play.on-dark{color:#111;background:rgba(245,245,245,.6)}#__play.on-dark:hover{background:rgba(245,245,245,.85)}`
    : '';

  // Optional figure background, painted on the body so it sits behind the surface (else transparent → theme bg).
  const bgCss = bg ? `body{background:${bg}}` : '';

  // Size #root to WxH so a mounted library has real dimensions; relative anchors its children, max-width avoids overflow.
  const rootCss = isRoot ? `#root{position:relative;width:${w}px;height:${h}px;max-width:100%}` : '';

  const css = `html,body{margin:0}${bgCss}${rootCss}canvas,svg{display:block;max-width:100%;height:auto}.err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}${playCss}`;

  // prelude/code sit on their own lines in run() so a trailing `//` in the author's source can't comment out the closing brace.
  const loadExt = fetched.length
    ? `const __fx=[${fetched.map((u) => JSON.stringify(u)).join(',')}];` +
      `const start=()=>__fx.reduce((p,u)=>p.then(()=>fetch(u)).then(r=>{if(!r.ok)throw new Error('external-lib '+u+' failed: HTTP '+r.status);return r.text()}).then(t=>{const s=document.createElement('script');s.textContent=t;document.head.appendChild(s)}),Promise.resolve()).then(run,e=>{document.body.innerHTML='<pre class=err>'+(e&&e.stack||e)+'</pre>';report()});`
    : `const start=run;`;
  const script =
    setup +
    `const loop=(fn)=>{let id;const t=(ts)=>{fn(ts);id=requestAnimationFrame(t)};id=requestAnimationFrame(t);return ()=>cancelAnimationFrame(id)};` +
    `const report=()=>parent.postMessage({__sandboxHeight:document.documentElement.scrollHeight},'*');` +
    `new ResizeObserver(report).observe(document.documentElement);` +
    `const run=()=>{try{\n${prelude}\n${code}\n}catch(e){document.body.innerHTML='<pre class=err>'+(e&&e.stack||e)+'</pre>'}report()};` +
    loadExt +
    // Deferred figures pick a contrasting play-button palette from the computed bg (works for any CSS color without parsing).
    (deferred
      ? `const __play=document.getElementById('__play'),__c=getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);if(__c&&(__c.length<4||+__c[3]>0)&&(0.299*__c[0]+0.587*__c[1]+0.114*__c[2])<128)__play.classList.add('on-dark');__play.addEventListener('click',()=>{__play.remove();start()});report();`
      : `start();`);

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${surface}${playBtn}${ext}<script>${script}</script></body></html>`;
}

// Scan raw markdown for sandbox fences with char offsets — the editor's inline preview works on source text, not the AST.
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
    // Collect the body to the closing fence even for non-sandbox blocks, so they don't desync the scan.
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
