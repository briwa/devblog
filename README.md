# Devblog

A markdown dev blog: an Astro static site with a built-in editor. Posts are `.md`
files in `src/content/posts/`; publishing writes one to the repo, you commit and
push, and the host rebuilds. No database, no CMS — markdown in git.

```
write + Publish  ──▶  src/content/posts/YYYY-MM-DD-title.md  ──▶  commit + push  ──▶  rebuild  ──▶  live
```

## Commands

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # astro build + pagefind search index → dist/
npm run pagefind   # rebuild just the search index into dist/pagefind/
npm run preview    # astro preview of the built dist/
```

In `astro dev`, publish/upload/delete are emulated by a Vite middleware
(`devPublish()` in `astro.config.mjs`) that writes straight to disk; commit and
push the files yourself. Search needs `npm run build` (or `npm run pagefind`) run
once to populate `dist/pagefind/`.

A post is just a file you can also create by hand:

```md
---
title: "My entry"
---

Body goes here.
```

The creation day comes from the filename (`YYYY-MM-DD-slug.md`), not frontmatter.
`updated` is optional and stamped automatically on edit.

## Configuration

| Name | Notes |
|------|-------|
| `PUBLIC_SITE_NAME` | Build-time. Header/title name; defaults to `Devblog` (`src/config.js`). |

## Deploy (static)

`npm run build` emits a static `dist/` (the site plus the `dist/pagefind/` search
index). Serve it from any static host — point the host's build command at
`npm run build` and its output directory at `dist/`, and every push to `main`
rebuilds.
