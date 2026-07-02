# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-author markdown dev blog: an Astro static site with a built-in writing
UI. Posts are markdown files in `src/content/posts/`; publishing from the in-app
editor writes a new `.md` to this repo, which you then commit and push — the host
rebuilds the static site. **No database, no CMS** — the source of truth is
markdown in git.

The site is a plain public static build: `npm run build` emits `dist/`, which any
static host can serve. The deployed site is **read-only** — the writing UI is a
**dev-only** quality-of-life feature (see *Authoring* below). You write locally in
`astro dev`, commit, and push.

## Commands

```bash
npm install
npm run dev        # astro dev → http://localhost:4321
npm run build      # astro build && pagefind (builds dist/ + search index)
npm run pagefind   # rebuild just the search index into dist/pagefind/
npm run preview    # astro preview of the built dist/
```

There is **no test suite, linter, or typecheck** configured — don't invent npm
scripts for them. Node version is pinned in `.node-version`.

To enable the `updated:` stamping git hook (see below), run once:
`git config core.hooksPath .githooks`.

## Conventions

- **Plain JS/JSX — no TypeScript.** No type annotations, no `.ts`. Match the
  existing files.
- **No new dependencies by default.** This is a deliberately small, vanilla,
  single-author project. Reach for the platform/stdlib first; add a library only
  when asked.
- **Comment the *why*, densely.** Nearly every non-obvious block here explains its
  reasoning (the date/UTC handling, the scroll-anchoring). New code should keep
  that density — explain the decision, not the mechanics.
- **No test/lint/typecheck exists** — don't invent verification commands. Verify by
  running `npm run dev` / `npm run build`.
- **Don't drive the app with Playwright / a browser to test changes** unless the
  user explicitly asks. Verify with `npm run build` and by reading the code; leave
  interactive/visual checking to the user.

## Authoring — dev-only, under `/admin/`

Creating, editing and deleting entries works **only in `astro dev`**, and the whole
editing surface lives under a single **`/admin/`** prefix — one path to auth-wall at
the edge (e.g. Cloudflare Access) if editing is ever exposed on a real backend:

- **`/admin/new`** — create a new entry (`EntryEditor` in `isNew` mode).
- **`/admin/edit?post=<slug>`** — edit an existing entry. A *dedicated page*, not an
  in-place `?edit` toggle on the public entry.
- Both are the one route **`src/pages/admin/[action].astro`** — just two static
  pages (`new`, `edit`), **not** one prerendered per post. The edit page is generic:
  it renders `AdminEdit.jsx`, which reads `?post=<slug>`, fetches that entry's source
  at runtime from `/admin/api/entry`, then hands it to the (prop-driven) `EntryEditor`.
- **`/admin/api/entry`** (GET) — read one entry's source for the editor.
- **`/admin/api/{publish,upload,delete}`** — the writes.

The editor (`EntryEditor.jsx`) reads from / POSTs to those `/admin/api/*` routes,
which are emulated by a Vite middleware, `devPublish()`, in `astro.config.mjs`,
reading/writing **straight to local disk** (`src/content/posts/`, `public/uploads/`).
You then commit and push the new files yourself, and the static host rebuilds.

There is no server in production to handle writes, so by default the whole editing
surface is stripped from a production build. **One env var flips it all
coherently:** editing is on when `import.meta.env.DEV` **or**
`PUBLIC_ENABLE_EDITING=true` (the `EDITING_ENABLED` flag in
**`src/lib/permissions.js`**, alongside the `CAN_CREATE`/`CAN_EDIT`/`CAN_DELETE`
permissions). With it **off** (the default outside dev):

- the `/admin` route builds nothing (`getStaticPaths` returns `[]`), so `dist/` has
  no `/admin` pages — a plain read-only archive;
- **`src/lib/adminBuild.js`** (an Astro integration in `astro.config.mjs`) drops the
  editor island from the bundle — Astro would otherwise ship its ~540KB of
  CodeMirror as an orphaned chunk (withastro/astro#4564) — and generates a
  `dist/_redirects` rule bouncing `/admin/*` to home;
- the read view's edit/new links (`EntryActions.jsx`) and the home's New/heatmap
  links don't render.

With it **on**, all of that reverses: `/admin` pages build, the editor stays
bundled, no redirect is written, and the links show. (It only makes sense once a
real `/admin/api/*` write backend exists — none does yet, so Save would fail; set
it as a genuine build env var, e.g. in Cloudflare Pages, since `adminBuild.js` reads
it from `process.env`.) To exclude another admin-only island from prod builds, add
its path to `ADMIN_ONLY_MODULES` in `adminBuild.js`.

`dist/pagefind/` is mirrored from disk by that same middleware, so search works in
dev *only after* you've run `npm run build` (or `npm run pagefind`) once. The
middleware also serves `/data/years.json` and `/data/<year>.json` fresh from disk
in dev, so a newly written entry shows on the home without a dev-server restart.

## Auto-title

The title is **optional**. Publish with a blank title and the server generates one
from the first prose paragraph — it feeds the frontmatter, the filename slug, *and*
the commit message, so it must be resolved before any of those are built (the client
just sends an empty title). The generator is a cheap Title-Cased first-words
heuristic (`fallbackTitle` in `src/lib/publish.js`, reused by `devPublish()`), so the
offline editor stays self-contained and makes no network call. A typed title is kept
verbatim. The publish response returns the resolved `title` so the editor's toast can
show what it chose. An entry with neither a title nor any content is rejected.

## Architecture

Astro SSG + React islands.

- **`src/content.config.js`** — the `posts` collection: a `glob` loader over
  `src/content/posts/**/*.md`. Schema is `title` (+ optional `updated`, `tags`).
- **`src/pages/index.astro` + `src/components/Home.jsx`** — home page. A
  GitHub-style activity heatmap (`react-activity-calendar`) + per-year entry list.
  The page only ships the *set of years*; each year's entries load on demand from
  `/data/<year>.json` (`src/pages/data/[year].json.js`) so the payload doesn't grow
  with the archive.
- **`src/pages/posts/[slug]/index.astro` + `src/components/EntryActions.jsx`** —
  the entry page. It's **read-only**: the static SSR view (`#entry-view`) plus a
  lightweight floating action bar (`EntryActions` — back-to-top, and owner-only
  edit/new *links* to `/admin/...`, gated on the permissions). It loads no
  CodeMirror; editing happens on a separate `/admin` route.
- **`src/pages/admin/[action].astro`** — the editing surface as just two static
  pages: `/admin/new` renders `EntryEditor` (`isNew`); `/admin/edit?post=<slug>`
  renders **`src/components/AdminEdit.jsx`**, which fetches the target entry's source
  at runtime (`/admin/api/entry`) and hands it to `EntryEditor`. No page is
  prerendered per post. `EntryEditor` is the large CodeMirror source editor (always
  editing): image upload, delete, toasts, the floating toolbar, the tag editor;
  Save/Cancel navigate back to the entry's read view. `getStaticPaths` yields
  nothing unless editing is enabled (`EDITING_ENABLED`), so **no `/admin` page is
  built in production** by default — the single build gate lives here. See the
  Authoring section and **`src/lib/adminBuild.js`** for the rest (dropping the editor
  islands from the bundle, generating the `/admin/*` redirect), all driven by the
  same flag.
- **`src/components/Search.astro`** — Pagefind full-text search in the header. Thin
  wrapper over Pagefind's JS API; index in `dist/pagefind/`. Entry pages carry
  `data-pagefind-body` so only entries are indexed (home/editor are skipped).
- **`src/layouts/Layout.astro`** (HTML shell + no-flash theme script) and
  **`src/layouts/Base.astro`** (header with slots for `brand`/`nav`, theme toggle,
  search). **`src/styles/global.css`** holds all styling and CSS variables; the
  CodeMirror theme in `EntryEditor.jsx` references those same `var(--...)` tokens so
  the editor follows light/dark with no JS.

## Dates — the one genuinely tricky invariant

There is **no `date` frontmatter field**. An entry's creation day is the
`YYYY-MM-DD` prefix of its filename, and that is the single source of truth
(`src/lib/created.js` → `createdOf`). The whole site renders dates in **UTC** and
anchors derived dates at UTC midnight, so a given filename day displays as that
same day everywhere regardless of where the site is built.

To make a post file under the *author's local* day rather than the server's UTC
day, the editor stamps timestamps as **local wall-clock wearing a `Z`** (see
`localStamp` in `EntryEditor.jsx`): an edit at 03:36 local reads back as that day
under UTC display. New posts send this as `date` (→ filename); edits send it as
`updated`. `updated` is stamped only on edit, never on create, so `created ===
updated` for never-edited posts, and "Updated …" shows only when the edit landed on
a different day than creation.

The **`.githooks/pre-commit`** hook stamps `updated:` into the frontmatter of posts
staged as *modified* (not newly added) under `src/content/posts/`, so manual edits
in a code editor get the same treatment as the in-app editor.

## Interactive figures (sandboxes)

A fenced code block whose info string is `js <preset>` (optionally a `WxH` size)
renders as a **live, runnable figure** in the entry — Bostock-style visualizations
embedded in prose. The preset picks the surface and bindings:

````md
```js canvas        → 2D canvas
```js svg 640x220   → an <svg> root, custom size
```js root 640x220  → a sized <div id="root"> mount point (for container libs)
```js svg code      → same, but with a "Show code" toggle on the figure
````

There's no built-in library preset: to use d3 (or any CDN library) load it with an
`external-lib` block and drive an `svg` or `root` figure with it (see below). Use
`root` for libraries that want to **own a container element** (Konva, Pts, PixiJS):
the figure exposes `root` (the `<div>`) and `'#root'` works as a selector, so you
hand the library the mount point instead of hand-rolling a div.

The published figure is **preview-only by default**; append the bare token `code`
(in any position, e.g. ` ```js svg 640x220 code `) to expose a "Show code" toggle on
it. (The in-editor preview always offers its own toggle regardless — you're editing
the source there.)

Append `bg="<color>"` (e.g. ` ```js canvas bg="#111" `) to paint the figure
background a specific color instead of inheriting the theme. **The quotes are
required** — an unquoted `bg=#111` is ignored and the figure keeps the theme
background (this keeps `bg` and `lib` consistent; see below). Quoting also lets the
value carry spaces, so hex (`#111`), named colors (`black`) and functional forms
(`rgb(20, 20, 20)`) all work. Canvas figures' centered play button reads its
rendered background at runtime and flips to a light-on-dark palette over a dark
background, so the button always contrasts.

By default a **canvas** *or* **root** figure opens paused behind that play button
and runs only on click (so animations — including a library's own ticker mounted
into `root` — don't burn rAF until asked). Append the bare token `auto` (e.g.
` ```js canvas auto `) to make it run on load instead — no play button. `auto` has
no effect on svg, which already runs on load.

A ` ```js lib ` block is **shared code, not a figure**: it renders no iframe — just
its highlighted source inside a collapsible, Notion-style `<details>` (a "lib" tag +
a clickable summary that reveals the code). The summary label defaults to a generic
prompt; set your own with the quoted `lib="<summary>"` form (e.g.
` ```js lib="Shared orbit helpers" `). **Quotes are required** — a bare `lib` or an
unquoted `lib=foo` just uses the default label (matching `bg`, above). Its code is
concatenated — in document order — into *every* figure in the same file as a
prelude, so helpers and consts written once are in scope for all figures. This is a **build-time text
composition**, not runtime sharing: the sandbox iframes are isolated null-origin
realms with no shared `window`, so `lib` source is simply inlined into each frame
(each gets its own private copy — written once by the author). The prelude runs
inside each figure's `try`/`catch` and outer scope (`sandboxPrelude` + `buildSrcdoc`
in `src/lib/sandbox.js`). All `lib` blocks apply to all figures regardless of
order. A `lib` block should *define* things, not run them (it executes in every
frame).

A ` ```js external-lib ` block is **shared code from a URL, not a figure** — the
remote counterpart of `lib`. Its body is one or more `https://` URLs (whitespace-
or newline-separated); each is injected as a classic ` <script src="…"> ` into the
figures of its group (in document order, before the figure's own code) — so a
library hosted on a CDN (jsDelivr, a raw-gist proxy like `cdn.jsdelivr.net/gist/…`,
unpkg, …) is in scope. Set a summary label with the quoted `external-lib="<summary>"`
form (matching `lib`/`bg`). It renders as the same collapsible `<details>` as
`lib`, but reveals the **URL(s) as links** rather than highlighted source. URLs
are validated (`safeUrl` in `src/lib/sandbox.js`): **https only**, and any char
that could break out of the `src="…"` attribute (`"`, `<`, `>`, quotes,
whitespace) is rejected — an invalid URL is dropped from injection but still shown
verbatim in the `<details>` so a typo isn't silent. Unlike `lib`, **nothing is
inlined**: this is a runtime fetch by the frame, so a figure now depends on that
URL staying reachable and won't run offline — prefer an inlined `lib` block for
code you can paste, and `external-lib` only for a real third-party library. Each
frame is a null-origin sandbox, so the script runs with no access to the parent
page or `/api/*`.

### Groups: `id="<group>"`

By default `lib`/`external-lib` blocks are shared with *every* figure in the file
(the default group, `""`). Add a quoted `id="<group>"` token to **partition** a
file: a figure receives only the `lib`/`external-lib`/`vue lib` blocks that carry
the **same** `id`. It's a pure equality partition — no "global applies to all"
tier, so an `id="x"` figure is fully isolated from default-group blocks. Use it to
scope a heavy `external-lib` (e.g. Vue) to the one figure that needs it instead of
injecting it into every frame. The id charset is `[\w-]+`; a malformed value falls
back to the default group. (`sandboxPrelude`/`sandboxExternals`/`sandboxVueComponents`
in `src/lib/sandbox.js` do the filtering.)

### Vue figures: ` ```vue `

`vue` is a second fence *language* (alongside `js`): the body is Vue 3 Single-File-
Component source, compiled **in the frame** by `vue3-sfc-loader` (CDN). Full SFC
syntax works with no build step — `<script setup>`, `<style scoped>`, the lot.

````md
```vue root 640x320        → mount the SFC into a sized #root div
```vue lib="MyComponent"   → a shared component (renders as a <details>, like `lib`)
````

A ` ```vue root ` figure mounts its SFC into the `#root` div (reusing the `root`
surface's sizing/scaling and the `WxH`/`bg`/`code`/`id` tokens; no play-button
deferral — a Vue app is interactive on load). A ` ```vue lib="Name" ` block is a
shared **component**: it renders no iframe (just its highlighted source in a
`<details>`, like `lib`), and is registered as global component `Name` in every
`vue` figure of its **group** (by `id`), so a figure's template can use `<Name>` /
`<name>` without importing. The Vue runtime + the loader are **auto-injected** (a
`vue` block can't function without them — they're the language's runtime, not an
optional library); any `external-lib` URLs in the group are injected too, before
Vue. Heavier than a `js` figure (each frame fetches Vue + the loader and compiles
the SFC in-browser), so a `vue` figure depends on those CDNs to render at all.
`buildVueSrcdoc` in `src/lib/sandbox.js` builds the frame; the SFC source is
embedded via `escapeTemplate` (which neutralizes any inner `</script>`).

**What's in scope for the authored code** (set up by `buildSrcdoc` before your
code runs; size defaults to `640x360`):

| binding | presets | what it is |
| --- | --- | --- |
| `loop(fn)` | all | self-cancelling `requestAnimationFrame` loop; calls `fn(timestamp)` each frame, returns a `stop()`. Animate with this so the loop dies with the frame. |
| `width`, `height` | all | the surface size (the `WxH` from the fence, or 640×360). |
| `canvas` | `canvas` | the `<canvas>` element. |
| `ctx` | `canvas` | its `2d` context (`canvas.getContext('2d')`). |
| `svg` | `svg` | the `<svg>` root element (raw DOM). |
| `root` | `root` | a sized `<div id="root">` (`position:relative`, WxH) to mount a library into; `'#root'` works as a selector too. |

Code loaded via an `external-lib` block isn't a binding — it runs as a classic
`<script src>` before your figure code, so its globals live on `window` (e.g. d3's
`d3`, just like any `<script src>` in a normal page). Reference them by their
global name; for d3, `d3.select(svg)`.

Authored code runs inside a `try/catch` — a throw renders the stack into the
frame instead of failing silently. The one thing it must not contain is a literal
`</script>` (it would close the wrapper); a non-issue for drawing code.

Each figure runs in its own `<iframe srcdoc=… sandbox="allow-scripts">` (no
`allow-same-origin`). The iframe is the point: a **disposable null-origin realm**
per block gives each its own globals (no `const width` collisions), clean teardown
of `requestAnimationFrame`/`setInterval` loops (removing the frame kills them), and
no access to the parent page or its DOM. Frames can't size themselves, so each
`postMessage`s its content height out and the host sets the iframe height.

- **`src/lib/sandbox.js`** — browser-safe core: `buildSrcdoc` (the iframe document,
  with the `loop()` helper + height reporter), `findSandboxBlocks` (a raw-markdown
  scanner), `parseMeta`, and the escapers. **No Shiki import** — the editor island
  imports this, so it must stay lean.
- **`src/lib/remarkSandbox.js`** — build-only remark plugin (registered via
  `markdown.processor: unified({ remarkPlugins: […] })` in `astro.config.mjs`, the
  non-deprecated path as of Astro 6.4). Replaces each sandbox fence with the figure
  markup: iframe **preview** + the source + a vanilla toggle. The source view is
  highlighted with **Astro's own `createShikiHighlighter`** (same default
  `github-dark` theme as every other code block) — done here, not via rehypeShiki,
  because the fence is replaced before rehype runs and Shiki would consume the
  preset `meta`.
- **`src/pages/posts/[slug]/index.astro`** — a small vanilla script (like the
  lightbox) sizes the published frames and runs the preview↔code toggle.
- **`src/lib/sandboxPreview.js`** — a CodeMirror extension giving the *editor* the
  same inline toggle: a recognized block defaults to editable code with a "Show
  preview" bar, and flips to an inline running figure (the same `buildSrcdoc`).

**Gotcha:** editing the plugin doesn't invalidate Astro's content cache (keyed on
the markdown file), so the rendered figures look stale after a plugin change —
`rm -rf .astro node_modules/.astro` before rebuilding. And since `remarkSandbox.js`
is imported by `astro.config.mjs`, restart `astro dev` after touching it.

## Search (Pagefind)

Full-text search is **Pagefind**, wired up in `src/components/Search.astro`. The
important operational facts:

- The index is **not** built by Astro. It's a separate CLI step (`pagefind --site
  dist`) that runs *after* `astro build` — which is why `npm run build` chains both,
  and why editing markdown and re-running only `astro build` leaves search stale.
  Re-run `npm run pagefind` (or full `npm run build`) to refresh it.
- The index lives in `dist/pagefind/`, served as a static asset like any other.
- Only entry pages are indexed: they carry `data-pagefind-body` (and
  `data-pagefind-meta` for title/date); the home and editor pages omit it, so
  Pagefind skips them.
- In `astro dev`, `dist/` isn't served, so the `devPublish()` middleware mirrors
  `dist/pagefind/` from disk. Before it's ever built the request 404s and the search
  UI shows a "run `npm run pagefind`" hint rather than erroring.

## Config / deploy

- Site display name: `SITE_NAME` in `src/config.js`, overridable via
  `PUBLIC_SITE_NAME` (build-time env / local `.env`).
- Build with `npm run build` (chains `astro build` + `pagefind`) and serve the
  resulting `dist/` from any static host. Every push to `main` — including the
  commits the editor's files make once you push them — can trigger the host to
  rebuild. See `README.md` for setup.
