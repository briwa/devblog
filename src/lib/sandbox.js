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

// Background for a figure with no explicit `bg`: follow the reader's theme. These mirror global.css's
// --bg so the media-query default is right until the host posts the exact colour (see themeBgListener).
const FIG_BG_LIGHT = '#fbfbf9';
const FIG_BG_DARK = '#17171a';
const themeBgCss = `:root{--sbx-bg:${FIG_BG_LIGHT}}@media(prefers-color-scheme:dark){:root{--sbx-bg:${FIG_BG_DARK}}}body{background:var(--sbx-bg)}`;
const themeBgListener = `addEventListener('message',function(e){if(e.data&&e.data.__sbxBg)document.documentElement.style.setProperty('--sbx-bg',e.data.__sbxBg)});`;

// The figure types offered in the sandbox editor: js presets plus vue (its own lang).
export const SANDBOX_TYPES = ['canvas', 'svg', 'root', 'vue'];
// Author-selectable playback modes (`control=<mode>`): pausable (default — play button, then tap-to-pause + reset),
// auto (runs on load, still tap-to-pause + reset), none (runs on load, no controls). `manual` is editor-only.
export const CONTROL_MODES = ['pausable', 'auto', 'none'];
export { DEFAULT_W, DEFAULT_H };

// Reduce a parsed figure block to the toolbar's editable state (type folds lang + preset).
export function specToToolbar(spec = {}) {
  return {
    type: spec.vue ? 'vue' : (spec.preset || 'canvas'),
    w: spec.w || DEFAULT_W,
    h: spec.h || DEFAULT_H,
    bg: spec.bg || '',
    showCode: Boolean(spec.showCode),
    control: spec.control || 'pausable',
    preview: Boolean(spec.preview),
    id: spec.id || '',
  };
}

// Serialize toolbar state back into a fence lang + meta string (inverse of parseMeta for figures).
export function serializeSandboxMeta({ type, w, h, bg, showCode, control, preview, id }) {
  const lang = type === 'vue' ? 'vue' : 'js';
  const tokens = [];
  if (type !== 'vue') tokens.push(type); // preset token; vue figures carry no preset
  if (w && h && !(Number(w) === DEFAULT_W && Number(h) === DEFAULT_H)) tokens.push(`${w}x${h}`);
  if (bg) tokens.push(`bg="${bg}"`);
  if (showCode) tokens.push('code');
  if (control && control !== 'pausable' && type !== 'vue') tokens.push(`control=${control}`); // pausable is the default; vue has no deferral
  if (preview) tokens.push('preview');
  if (id) tokens.push(`id="${id}"`);
  return { lang, meta: tokens.join(' ') };
}

// Build a complete fenced block from toolbar state + code, ready to splice into the document.
export function buildSandboxFence(state, code) {
  const { lang, meta } = serializeSandboxMeta(state);
  const head = meta ? `${lang} ${meta}` : lang;
  return '```' + head + '\n' + (code || '') + '\n```';
}

// Build a lib block: 'external' (URL body), 'source' (shared js), or 'vue' (shared SFC component).
export function buildLibFence({ kind, label = '', name = '', id = '' }, code = '') {
  let head;
  if (kind === 'external') head = 'js external-lib' + (label ? `="${label}"` : '');
  else if (kind === 'vue') head = `vue lib="${name}"`;
  else head = 'js lib' + (label ? `="${label}"` : '');
  if (id) head += ` id="${id}"`;
  return '```' + head + '\n' + (code || '') + '\n```';
}

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
    return { vue: true, preset: 'root', w: vw, h: vh, showCode: tokens.includes('code'), bg: vbg, id, preview: tokens.includes('preview') };
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
  // Playback mode `control=<mode>` (pausable | auto | none); default pausable. A bare `auto` token is shorthand
  // for `control=auto`. Unknown values fall back to the default.
  const cm = /(?:^|\s)control="?([a-z]+)"?/.exec(raw);
  let control = cm ? cm[1] : (tokens.includes('auto') ? 'auto' : 'pausable');
  if (!CONTROL_MODES.includes(control)) control = 'pausable';
  // Optional `bg="<color>"` (quotes required); charset-restricted so it can't break out of the style attribute.
  const bgMatch = /(?:^|\s)bg="([^"]*)"/.exec(raw);
  let bg = bgMatch ? bgMatch[1] : '';
  if (bg && !/^[#\w(),.%\s-]+$/.test(bg)) bg = '';
  // Opt-in `preview` token: nominate this figure as the entry's home-page cover.
  return { preset, w, h, showCode, bg, control, id, preview: tokens.includes('preview') };
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
  const bgCss = bg ? `body{background:${bg}}` : themeBgCss; // no explicit bg → follow the reader's theme
  const rootCss = `#root{position:relative;width:${w}px;height:${h}px;max-width:100%}`;
  // overflow:hidden mirrors buildSrcdoc — clip the sub-pixel hairline a scaled canvas/svg (height:auto) leaves, else a scrollbar.
  const css = `html,body{margin:0;overflow:hidden}${bgCss}${rootCss}canvas,svg{display:block;max-width:100%;height:auto}.err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}`;

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
    (bg ? '' : themeBgListener) +
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
// `control` is the playback mode: 'pausable' (default) | 'auto' | 'none' | 'manual'. 'manual' (editor preview only)
// lets the toolbar drive the rAF loop via {__figplay}/{__figpause}/{__figreset} messages; the rest run on the page.
// canvas/root figures also get `reset()` + `onCleanup()` globals (see resetApi): a soft, no-reload rebuild.
export function buildSrcdoc({ preset, w, h, bg, hover, control }, code, prelude = '', externals = []) {
  const isCanvas = preset === 'canvas';
  // The emitted boilerplate is TERSE on purpose — it's inlined into every srcdoc, so its comments/indentation would ship verbatim.
  // `root` is a bare sized mount point so a container-owning library (Konva, Pts, Pixi) can take it directly.
  const isRoot = preset === 'root';
  const mode = control || 'pausable';
  const isManual = mode === 'manual'; // editor preview: toolbar drives play/pause/reset via postMessage
  // Tap-to-pause: while running, tapping the surface pauses and reveals a resume button with a small reset below it.
  // Canvas-only (not root/svg), for pausable + auto modes; never under editor-manual/hover.
  const pausable = isCanvas && (mode === 'pausable' || mode === 'auto') && !hover;
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

  // Pausable canvas/root default to PAUSED behind an in-frame play button (spares rAF); auto/none/manual run without it.
  const deferred = (isCanvas || isRoot) && mode === 'pausable' && !hover;
  const playBtn = deferred
    ? `<button id="__play" type="button" aria-label="Run figure"><svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true"><polygon points="38,28 38,72 74,50" fill="currentColor"/></svg></button>`
    : '';
  // Pause overlay for a running canvas: a resume (▶) button with a smaller reset (↺) below it; hidden while running.
  const ctlOverlay = pausable
    ? `<div id="__ctl" hidden><button id="__resume" type="button" aria-label="Resume figure"><svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true"><polygon points="38,28 38,72 74,50" fill="currentColor"/></svg></button><button id="__rst" type="button" aria-label="Reset figure"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button></div>`
    : '';
  // Play-overlay CSS, only when deferred; the runtime `.on-dark` variant flips fill/icon so the button always contrasts.
  const playCss = deferred
    ? `#__play{position:absolute;inset:0;margin:auto;width:64px;height:64px;border:0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,20,.55);transition:background .15s,transform .15s}#__play:hover{background:rgba(20,20,20,.8);transform:scale(1.06)}#__play.on-dark{color:#111;background:rgba(245,245,245,.6)}#__play.on-dark:hover{background:rgba(245,245,245,.85)}`
    : '';
  // Pause-overlay CSS (pausable canvas only): container is click-through so a backdrop tap reaches the canvas to resume;
  // buttons opt back into pointer events. Resume sits dead-centre exactly where the play button was; reset tucks below it.
  // `.on-dark` mirrors the play button so the controls stay legible on any bg.
  const ctlCss = pausable
    ? `#__ctl{position:absolute;inset:0;pointer-events:none}#__ctl[hidden]{display:none}#__ctl button{position:absolute;pointer-events:auto;border:0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,20,.55);transition:background .15s,transform .15s}#__ctl button:hover{background:rgba(20,20,20,.8)}#__resume{inset:0;margin:auto;width:64px;height:64px}#__resume:hover{transform:scale(1.06)}#__rst{left:50%;top:50%;transform:translate(-50%,42px);width:34px;height:34px}#__rst:hover{transform:translate(-50%,42px) scale(1.06)}#__ctl.on-dark button{color:#111;background:rgba(245,245,245,.6)}#__ctl.on-dark button:hover{background:rgba(245,245,245,.85)}`
    : '';

  // Figure background: explicit `bg` wins; otherwise follow the reader's theme (see themeBgCss).
  // A sandboxed iframe renders opaque, so leaving it unpainted shows white — covers included.
  const bgCss = bg ? `body{background:${bg}}` : themeBgCss;
  // On the host's theme push: follow the colour (unless bg is explicit) AND re-report height. The push is
  // the host's "my listener is attached" signal, so it doubles as a reliable late size report — the frame's
  // own initial report can fire during page parse, before the host's (deferred module) listener exists.
  const themeSync = `addEventListener('message',function(e){if(e.data&&e.data.__sbxBg){${bg ? '' : `document.documentElement.style.setProperty('--sbx-bg',e.data.__sbxBg);`}report()}});`;

  // Size #root to WxH so a mounted library has real dimensions; relative anchors its children, max-width avoids overflow.
  const rootCss = isRoot
    ? (hover ? `#root{position:relative;width:100%;height:100%}` : `#root{position:relative;width:${w}px;height:${h}px;max-width:100%}`)
    : '';

  // hover covers fill the frame (already sized to the figure's aspect), so the media leaves no gap.
  const media = hover
    ? `html,body{height:100%}canvas,svg{display:block;width:100%;height:100%}`
    : `canvas,svg{display:block;max-width:100%;height:auto}`;
  // overflow:hidden — the frame is sized to the doc's scrollHeight (see .sandbox-frame), so a sub-pixel fraction from a
  // scaled canvas (height:auto) would otherwise leave a hairline of overflow and a vertical scrollbar. scrollHeight is
  // measured regardless of overflow, so auto-sizing is unaffected.
  const css = `html,body{margin:0;overflow:hidden}${bgCss}${rootCss}${media}.err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}${playCss}${ctlCss}`;

  // prelude/code sit on their own lines in run() so a trailing `//` in the author's source can't comment out the closing brace.
  const loadExt = fetched.length
    ? `const __fx=[${fetched.map((u) => JSON.stringify(u)).join(',')}];` +
      `const start=()=>__fx.reduce((p,u)=>p.then(()=>fetch(u)).then(r=>{if(!r.ok)throw new Error('external-lib '+u+' failed: HTTP '+r.status);return r.text()}).then(t=>{const s=document.createElement('script');s.textContent=t;document.head.appendChild(s)}),Promise.resolve()).then(run,e=>{document.body.innerHTML='<pre class=err>'+(e&&e.stack||e)+'</pre>';report()});`
    : `const start=run;`;
  // canvas/root loops record their cancel handle in __stop so reset() can stop them (declared in resetVars).
  const resettable = (isCanvas || isRoot) && !hover;
  // hover: draw first frame and freeze; play/pause on hover uses the same elapsed-banking timeline as manual/pausable
  // (bank __el on leave, rebase __t0 on re-enter) so re-hovering resumes where it stopped instead of jumping to the
  // frame it would be at in raw page time. manual: auto-run but hold the rAF handle so the toolbar can pause/resume it.
  const loopDef = hover
    ? `let __fn=null,__raf=null,__el=0,__t0=null,__now=0;const __tick=(ts)=>{if(__t0==null)__t0=ts;__now=__el+(ts-__t0);__fn(__now);if(__raf!=null)__raf=requestAnimationFrame(__tick)};const loop=(fn)=>{__fn=fn;fn(0)};`
    : isManual
      // ts is elapsed-since-play, not the raw rAF stamp — else pressing play seconds after load hands the figure a huge t.
      // The reschedule is guarded (if __raf!=null) so reset() called from inside __fn doesn't resurrect the loop.
      ? `let __fn=null,__raf=null,__el=0,__t0=null,__now=0;const __tick=(ts)=>{if(__t0==null)__t0=ts;__now=__el+(ts-__t0);__fn(__now);if(__raf!=null)__raf=requestAnimationFrame(__tick)};const loop=(fn)=>{__fn=fn;fn(0);${resettable ? `__stop=()=>{if(__raf!=null){cancelAnimationFrame(__raf);__raf=null}};return __stop` : `return ()=>{if(__raf!=null){cancelAnimationFrame(__raf);__raf=null}}`}};`
      : pausable
        // Same elapsed-since-play timeline as manual mode: loop() draws frame 0 but does NOT schedule rAF — the tail
        // kicks it (via __resumeFig) on play/autorun, so a deferred figure shows its first frame instead of a blank
        // canvas behind the play button. Pause/resume is driven in-frame by taps; __stop lets reset() cancel it.
        ? `let __fn=null,__raf=null,__el=0,__t0=null,__now=0;const __tick=(ts)=>{if(__t0==null)__t0=ts;__now=__el+(ts-__t0);__fn(__now);if(__raf!=null)__raf=requestAnimationFrame(__tick)};const loop=(fn)=>{if(__stop)__stop();__fn=fn;fn(0);return (__stop=()=>{if(__raf!=null){cancelAnimationFrame(__raf);__raf=null}})};`
      : resettable
        // ts is elapsed-since-start (t0-based), matching control mode — so a figure keyed on t behaves the same
        // on the page as in the editor. `live` guards the reschedule so reset() from inside fn stops cleanly.
        ? `const loop=(fn)=>{if(__stop)__stop();let id,live=true,t0=null;const t=(ts)=>{if(t0==null)t0=ts;fn(ts-t0);if(live)id=requestAnimationFrame(t)};id=requestAnimationFrame(t);return (__stop=()=>{live=false;cancelAnimationFrame(id)})};`
        : `const loop=(fn)=>{let id;const t=(ts)=>{fn(ts);id=requestAnimationFrame(t)};id=requestAnimationFrame(t);return ()=>cancelAnimationFrame(id)};`;

  // Soft, no-reload reset() for canvas/root, exposed alongside ctx/width/height/loop: cancel the loop, run
  // author cleanups, wipe the surface, then return to the initial state. onCleanup(fn) lets a figure undo
  // side effects a soft reset can't see; a pure loop needs none.
  const resetVars = resettable ? `let __stop=null,__cleanups=[];` : '';
  // Return-to-initial, per mode: editor rewinds to a paused frame 0; a page figure re-shows its play button;
  // an auto figure replays. The parent is notified so the editor toolbar can drop back to paused.
  const resetHome = isManual
    ? `__el=0;__t0=null;__now=0;__fn=null;run()`
    : pausable
      // Rewind the timeline, hide the overlay, redraw frame 0 (run → loop draws but holds), then return to the initial
      // state: paused first frame behind the play button (deferred), or resume the loop (auto).
      ? `__el=0;__t0=null;__now=0;__fn=null;__ctl.hidden=true;run();` + (deferred ? `__play.style.display='flex'` : `__resumeFig()`)
      : deferred
        ? `__play.style.display='flex'`
        : `run()`;
  // Non-resettable frames (home-page hover covers, svg) still expose reset()/onCleanup() as no-ops so the
  // same author code that calls reset() elsewhere doesn't throw here — a cover just loops and ignores it.
  const resetApi = resettable
    ? `const onCleanup=(fn)=>{__cleanups.push(fn)};` +
      `const __teardown=()=>{if(__stop){__stop();__stop=null}__cleanups.forEach(function(fn){try{fn()}catch(_){}});__cleanups=[];${isCanvas ? 'canvas.width=width' : "root.innerHTML=''"}};` +
      `const reset=()=>{__teardown();${resetHome};parent.postMessage({__sandboxReset:1},'*')};`
    : `const onCleanup=()=>{};const reset=()=>{};`;

  // Pausable canvas: tap the surface to toggle pause; when paused the overlay shows a resume + reset button.
  // __ctlContrast keeps the overlay legible against the figure's background (mirrors the play button's contrast).
  const pauseControls = pausable
    ? `const __ctl=document.getElementById('__ctl');` +
      `const __ctlContrast=()=>{const c=getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);__ctl.classList.toggle('on-dark',!!(c&&(c.length<4||+c[3]>0)&&(0.299*c[0]+0.587*c[1]+0.114*c[2])<128))};__ctlContrast();${bg ? '' : `addEventListener('message',function(e){if(e.data&&e.data.__sbxBg)requestAnimationFrame(__ctlContrast)});`}` +
      `const __pause=()=>{if(__raf!=null){cancelAnimationFrame(__raf);__raf=null;__el=__now;__ctl.hidden=false}};` +
      // Hide the play button here too, not just in its own handler — a backdrop tap resumes without ever touching it.
      `const __resumeFig=()=>{__ctl.hidden=true;${deferred ? `__play.style.display='none';` : ''}if(__raf==null&&__fn){__t0=null;__raf=requestAnimationFrame(__tick)}};` +
      `canvas.addEventListener('click',()=>{if(__raf!=null)__pause();else if(__fn)__resumeFig()});` +
      `document.getElementById('__resume').addEventListener('click',e=>{e.stopPropagation();__resumeFig()});` +
      `document.getElementById('__rst').addEventListener('click',e=>{e.stopPropagation();reset()});`
    : '';

  // Hide (not remove) the play button so reset() can bring it back for a fresh run.
  // __contrast keeps the play button legible against the figure's background; re-run it on each theme push
  // (the parse-time background is only the media-query default until the host posts the resolved colour).
  const playSetup = `const __play=document.getElementById('__play');const __contrast=()=>{const c=getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);__play.classList.toggle('on-dark',!!(c&&(c.length<4||+c[3]>0)&&(0.299*c[0]+0.587*c[1]+0.114*c[2])<128))};__contrast();${bg ? '' : `addEventListener('message',function(e){if(e.data&&e.data.__sbxBg)requestAnimationFrame(__contrast)});`}`;
  const tail = deferred
    // Pausable canvas: prime frame 0 on load (start → loop draws but holds), then play resumes the held loop.
    // Root: no in-frame pause, so keep it blank until play, where start() runs and animates.
    ? pausable
      // Controls before start() so their elements are captured even if run() throws and wipes the body.
      ? playSetup + pauseControls + `__play.addEventListener('click',()=>__resumeFig());start();report();`
      : playSetup + `__play.addEventListener('click',()=>{__play.style.display='none';start()});report();`
    : isManual
      // pause banks elapsed; play clears __t0 so the next tick rebases and the timeline resumes seamlessly.
      // __figreset (canvas/root only) is the toolbar's Reset: soft rewind to a paused frame 0, no remount.
      ? `start();addEventListener('message',function(e){if(!e.data)return;if(e.data.__figpause){if(__raf!=null){cancelAnimationFrame(__raf);__raf=null;__el=__now}}else if(e.data.__figplay){if(__raf==null&&__fn){__t0=null;__raf=requestAnimationFrame(__tick)}}${resettable ? `else if(e.data.__figreset){reset()}` : ''}});`
      : hover
        // Draw frame 0, then play on {__figplay:true} / pause on {__figplay:false}, banking elapsed so re-hover resumes
        // where it stopped. Only react to __figplay messages — a theme (__sbxBg) push must not pause a hovered figure.
        ? `start();addEventListener('message',function(e){if(!__fn||!e.data)return;if(e.data.__figplay){if(__raf==null){__t0=null;__raf=requestAnimationFrame(__tick)}}else if('__figplay' in e.data){if(__raf!=null){cancelAnimationFrame(__raf);__raf=null;__el=__now}}});`
        // Auto/none canvas: wire the controls before start() so its elements are captured even if run() throws and wipes
        // the body. An auto (pausable) figure draws frame 0 in start(), then __resumeFig kicks the held loop into motion.
        : pauseControls + `start();` + (pausable ? `__resumeFig();` : ``);
  const script =
    setup +
    resetVars +
    loopDef +
    resetApi +
    `const report=()=>parent.postMessage({__sandboxHeight:document.documentElement.scrollHeight},'*');` +
    `new ResizeObserver(report).observe(document.documentElement);` +
    themeSync +
    // Surface runtime throws too: the loop runs in later rAF frames, outside run()'s try, so an in-loop error would otherwise only hit the console.
    `const showErr=(m)=>{document.body.innerHTML='<pre class=err>'+m+'</pre>';report()};` +
    `addEventListener('error',e=>showErr((e.error&&e.error.stack)||e.message));` +
    `addEventListener('unhandledrejection',e=>showErr((e.reason&&e.reason.stack)||e.reason));` +
    `const run=()=>{try{\n${prelude}\n${code}\n}catch(e){showErr(e&&e.stack||e);return}report()};` +
    loadExt +
    tail;

  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${surface}${playBtn}${ctlOverlay}${ext}<script>${script}</script></body></html>`;
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
