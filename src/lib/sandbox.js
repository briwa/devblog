// Interactive figure sandboxes.
//
// A fenced code block whose info string is `js <preset>` (optionally with a
// `WxH` size) is turned into a live, runnable figure embedded in the post:
//
//     ```js canvas        → 2D canvas, exposes `canvas`, `ctx`, `width`, `height`
//     ```js svg           → an <svg> root, exposes `svg`, `width`, `height`
//     ```js d3 800x500    → an <svg> root + the d3 v7 global, custom size
//
// Append the bare token `code` (e.g. ```js d3 code) to expose a "Show code"
// toggle on the published figure; without it the figure is preview-only.
//
// Append `bg=<color>` (e.g. ```js canvas bg=#111) to paint the figure's
// background a specific color instead of inheriting the theme. The play overlay
// (canvas figures) auto-picks a contrasting palette for the chosen background.
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
const PRESETS = new Set(['canvas', 'svg', 'd3']);
const DEFAULT_W = 640;
const DEFAULT_H = 360;

// d3 v7, loaded from a CDN *inside* the sandbox frame. A sandboxed null-origin
// frame may still load external subresources (the sandbox restricts origin
// privileges, not network), so this needs no local dependency. Only the `d3`
// preset injects it, keeping the plain canvas/svg case lean.
const D3_SRC = 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js';

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
  if (lang !== 'js' && lang !== 'javascript') return null;
  const tokens = (meta || '').trim().split(/\s+/).filter(Boolean);
  const preset = tokens.find((t) => PRESETS.has(t));
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
  // on svg/d3, which already run on load.
  const auto = tokens.includes('auto');
  // Optional `bg=<color>` paints the figure body. The value is a single token
  // (no spaces), so hex (`#111`), named colors (`black`) and space-free
  // functional forms (`rgb(20,20,20)`) all work. Restrict to a safe CSS-color
  // charset so a stray token can't break out of the style/attribute it lands in.
  const bgToken = tokens.find((t) => t.startsWith('bg='));
  let bg = bgToken ? bgToken.slice(3) : '';
  if (bg && !/^[#\w(),.%-]+$/.test(bg)) bg = '';
  return { preset, w, h, showCode, bg, auto };
}

// Build the inner document for one figure. `code` is the author's verbatim JS.
// Returns the RAW document string. The remark plugin escapes it for an HTML
// attribute (escapeAttr); the editor's live preview passes it straight to a
// React `srcDoc` prop, which does its own escaping — so escaping here would
// double-encode. Keep this function attribute-agnostic.
export function buildSrcdoc({ preset, w, h, bg, auto }, code) {
  const isCanvas = preset === 'canvas';
  // The surface element and the bindings handed to the authored code.
  const surface = isCanvas ? '<canvas></canvas>' : `<svg viewBox="0 0 ${w} ${h}"></svg>`;
  const setup = isCanvas
    ? `const canvas = document.querySelector('canvas');
       const ctx = canvas.getContext('2d');
       const width = canvas.width = ${w};
       const height = canvas.height = ${h};`
    : `const svg = document.querySelector('svg');
       const width = ${w}, height = ${h};`;
  // d3 is a classic script, so it runs (and defines `d3`) before the next one.
  const lib = preset === 'd3' ? `<script src="${D3_SRC}"></script>` : '';

  // A canvas figure animates via loop() and shouldn't burn rAF the moment the page
  // loads — by default it opens PAUSED behind a centered, YouTube-style play button
  // and runs only on click. The `auto` token opts a canvas figure into running on
  // load instead. svg/d3 figures are typically a single static draw, so they run
  // on load regardless. The button lives INSIDE the frame (not as a host overlay)
  // so the deferral behaves identically on the published page and in the editor's
  // live preview, both of which share this one srcdoc — no extra host JS, no
  // cross-frame "start" message. The blank canvas placeholder reports its height
  // just like a drawn one, so the frame is already sized to center the button in.
  const deferred = isCanvas && !auto;
  const playBtn = deferred
    ? `<button id="__play" type="button" aria-label="Run figure">` +
      `<svg viewBox="0 0 100 100" width="30" height="30" aria-hidden="true"><polygon points="38,28 38,72 74,50" fill="currentColor"/></svg>` +
      `</button>`
    : '';
  // Only canvas frames carry the play overlay, so only they need its CSS — keep
  // the svg/d3 frames free of dead rules. inset:0 + margin:auto centers the button
  // over the (unpositioned) body, which fills the frame = the canvas box. The
  // default dark translucent fill reads on light/transparent backgrounds; the
  // `.on-dark` variant (applied at runtime when the background is dark — see
  // below) flips to a light fill with a dark icon so the button always contrasts.
  // The triangle is nudged right so it looks optically centered in the circle.
  const playCss = deferred
    ? `#__play{position:absolute;inset:0;margin:auto;width:64px;height:64px;border:0;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(20,20,20,.55);transition:background .15s,transform .15s}
       #__play:hover{background:rgba(20,20,20,.8);transform:scale(1.06)}
       #__play.on-dark{color:#111;background:rgba(245,245,245,.6)}
       #__play.on-dark:hover{background:rgba(245,245,245,.85)}`
    : '';

  // A custom figure background, if requested. Painted on the body so it sits
  // behind the canvas/svg surface; without it the body is transparent and the
  // frame shows the theme background (.sandbox-frame's var(--bg)) as before.
  const bgCss = bg ? `body{background:${bg}}` : '';

  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0}
    ${bgCss}
    canvas,svg{display:block;max-width:100%;height:auto}
    .err{color:#c0392b;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;padding:.75rem}
    ${playCss}
  </style></head><body>${surface}${playBtn}${lib}<script>
    ${setup}
    // A self-cancelling rAF helper so authored animation loops are easy to write
    // and die with the frame: loop(fn) runs fn every frame, returns a stop().
    const loop = (fn) => { let id; const t = (ts) => { fn(ts); id = requestAnimationFrame(t); }; id = requestAnimationFrame(t); return () => cancelAnimationFrame(id); };
    // Report our content height to the parent so it can size the (otherwise
    // unsized) iframe to fit, and re-report whenever the layout reflows.
    const report = () => parent.postMessage({ __sandboxHeight: document.documentElement.scrollHeight }, '*');
    new ResizeObserver(report).observe(document.documentElement);
    // The authored code, wrapped so a throw renders its stack into the frame
    // instead of failing silently. Deferred (canvas) figures call this on click;
    // others on load.
    const run = () => { try { ${code} } catch (e) { document.body.innerHTML = '<pre class=err>' + (e && e.stack || e) + '</pre>'; } report(); };
    ${deferred
      ? `const __play = document.getElementById('__play');
         // Give the play button a palette that contrasts with whatever the figure
         // actually renders behind it: read the body's COMPUTED background, and if
         // it's dark (and opaque) switch to the light-on-dark variant. Reading the
         // computed value means this works for any CSS color the author writes —
         // named, hex, rgb(), hsl() — without parsing color syntax ourselves. A
         // transparent body (no bg= given) keeps the default, which already reads
         // on the theme background.
         const __c = getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g);
         if (__c && (__c.length < 4 || +__c[3] > 0) && (0.299*__c[0] + 0.587*__c[1] + 0.114*__c[2]) < 128) {
           __play.classList.add('on-dark');
         }
         __play.addEventListener('click', () => { __play.remove(); run(); });
         report();`
      : `run();`}
  </script></body></html>`;

  return doc;
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
