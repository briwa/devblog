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

## Authoring — dev-only by design

Creating, editing and deleting entries works **only in `astro dev`**. The in-app
editor (`EntryEditor.jsx`) POSTs to `/api/publish`, `/api/upload` and `/api/delete`,
which are emulated by a Vite middleware, `devPublish()`, in `astro.config.mjs`,
writing **straight to local disk** (`src/content/posts/`, `public/uploads/`). You
then commit and push the new files yourself, and the static host rebuilds.

There is no server in production to handle those routes, so the editing affordances
are **hidden in a production build**. Every "write" control — the header `+`, the
heatmap's empty-day links, the entry's edit pencil, the new-entry `+`, delete —
gates on the named capabilities in **`src/lib/capabilities.js`** (`CAN_CREATE`,
`CAN_EDIT`, `CAN_DELETE`), which there are all simply `import.meta.env.DEV`. A built
`dist/` is therefore a plain read-only archive.

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
- **`src/pages/posts/[slug]/index.astro` + `src/components/EntryEditor.jsx`** —
  entry page. View and edit are the **same page**: the static SSR view (`#entry-view`)
  is shown read-only; the pencil flips to an in-place CodeMirror source editor
  (toggles `?edit`, no navigation). `EntryEditor` is large and handles the editor,
  image upload, delete, toasts, the floating toolbar, and scroll-anchoring across
  the view↔edit swap.
- **`src/pages/posts/new/index.astro`** — new entry; just `EntryEditor` in
  always-editing mode (`isNew`).
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
```js svg 640x220   → an <svg> root
```js d3 800x500    → an <svg> root + the d3 v7 global (CDN), custom size
```js d3 code       → same, but with a "Show code" toggle on the figure
````

The published figure is **preview-only by default**; append the bare token `code`
(in any position, e.g. ` ```js d3 800x500 code `) to expose a "Show code" toggle on
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

By default a **canvas** figure opens paused behind that play button and runs only
on click (so animations don't burn rAF until asked). Append the bare token `auto`
(e.g. ` ```js canvas auto `) to make it run on load instead — no play button.
`auto` has no effect on svg/d3, which already run on load.

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

**What's in scope for the authored code** (set up by `buildSrcdoc` before your
code runs; size defaults to `640x360`):

| binding | presets | what it is |
| --- | --- | --- |
| `loop(fn)` | all | self-cancelling `requestAnimationFrame` loop; calls `fn(timestamp)` each frame, returns a `stop()`. Animate with this so the loop dies with the frame. |
| `width`, `height` | all | the surface size (the `WxH` from the fence, or 640×360). |
| `canvas` | `canvas` | the `<canvas>` element. |
| `ctx` | `canvas` | its `2d` context (`canvas.getContext('2d')`). |
| `svg` | `svg`, `d3` | the `<svg>` root element (raw DOM; `d3.select(svg)` under `d3`). |
| `d3` | `d3` | the global d3 v7, loaded from the CDN *inside* the frame. |

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
