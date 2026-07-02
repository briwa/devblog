import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unified } from '@astrojs/markdown-remark';
import { remarkStripHtml } from './src/lib/remarkStripHtml.js';
import { remarkSandbox } from './src/lib/remarkSandbox.js';
// Keeps the dev-only /admin editing surface out of production builds (unless
// PUBLIC_ENABLE_EDITING is set) — island exclusion + the /admin redirect.
import { adminBuild } from './src/lib/adminBuild.js';
// Entry helpers (filename/slug derivation, path validation, frontmatter parsing,
// the blank-title fallback) used by the dev publish middleware below — see
// src/lib/publish.js.
import {
  fallbackTitle,
  frontmatterTags,
  frontmatterTitle,
  isValidPostPath,
  parseTags,
  slugify,
  uploadFilename,
} from './src/lib/publish.js';
// The home-data shapes, shared with the real /data endpoints so the dev mirror
// below doesn't hand-reimplement the summary/year logic — see src/lib/entryData.js
// (kept astro:content-free precisely so this Vite config can import it).
import { entrySummary, yearsOf } from './src/lib/entryData.js';

// Dev-only authoring: the deployed static site has no server for the editor's
// /admin/api/* routes, so these middlewares stand in for /admin/api/publish,
// /admin/api/upload and /admin/api/delete by writing straight to disk — letting
// you create, edit and add images locally. The whole editing surface lives under
// /admin/ (UI routes + this API) so a single path prefix can be auth-walled at the
// edge (e.g. Cloudflare Access) if editing is ever exposed on a real backend. A
// production build is still read-only (see src/lib/capabilities.js): the /admin
// pages redirect away and this API doesn't exist off the dev server.
function devPublish() {
  const sendJson = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  };

  return {
    name: 'dev-publish',
    apply: 'serve',
    configureServer(server) {
      const root = () => server.config.root;

      // Serve the Pagefind index in dev. `astro dev` never serves dist/, so the
      // search assets (built by `npm run pagefind` into dist/pagefind/) would 404.
      // Mirror them here from disk; if they're missing the request 404s and the
      // search UI shows its "run pagefind" hint. Run `npm run build` (or
      // `astro build && npm run pagefind`) once to populate the index.
      server.middlewares.use('/pagefind', async (req, res, next) => {
        const base = join(root(), 'dist', 'pagefind');
        const file = join(base, decodeURIComponent((req.url || '').split('?')[0]));
        if (!file.startsWith(base)) return next(); // path traversal guard
        try {
          const data = await readFile(file);
          const ext = file.slice(file.lastIndexOf('.'));
          const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
          res.setHeader('content-type', types[ext] || 'application/octet-stream');
          res.end(data);
        } catch {
          next(); // not built yet → 404 → client urges `npm run pagefind`
        }
      });

      // Serve the home's data endpoints fresh from disk in dev. /data/years.json
      // and /data/<year>.json are produced in prod by dynamic routes whose
      // getStaticPaths() enumerates the years that have entries (src/pages/data/*,
      // backed by src/lib/entries.js). `astro dev` caches that enumeration, so the
      // FIRST entry of a new year — most visibly the first entry on an empty blog —
      // 404s (`no matching static path for /data/<year>.json`) until a dev-server
      // restart re-runs getStaticPaths. Reading the posts dir on each request here
      // sidesteps that: a freshly published entry shows up with no restart. This
      // reuses the entry-summary shape from entryData.js (id/title/iso/tags); a
      // production build is unaffected and still serves the real prerendered
      // endpoints.
      server.middlewares.use('/data', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const path = (req.url || '').split('?')[0];
        const wantsYears = path === '/years.json';
        const yearMatch = /^\/(\d{4})\.json$/.exec(path);
        if (!wantsYears && !yearMatch) return next(); // not a data route we mirror

        const dir = join(root(), 'src', 'content', 'posts');
        // Missing dir / empty repo → empty result, not an error (matches the prod
        // endpoints when there are no posts). readdir is sorted for a stable order.
        const files = (await readdir(dir).catch(() => []))
          .filter((f) => f.endsWith('.md'))
          .sort();
        // Build the minimal post-like shape entrySummary/yearsOf expect — the same
        // { id, data: { title, tags } } getCollection hands the real endpoints —
        // reading title/tags from frontmatter since there's no astro:content here.
        const posts = await Promise.all(
          files.map(async (f) => {
            const id = f.slice(0, -3); // strip .md → the same id Astro's glob uses
            const text = await readFile(join(dir, f), 'utf8').catch(() => '');
            return { id, data: { title: frontmatterTitle(text) || id, tags: frontmatterTags(text) } };
          }),
        );

        if (wantsYears) return sendJson(res, 200, yearsOf(posts));
        const year = yearMatch[1];
        return sendJson(res, 200, posts.filter((p) => p.id.slice(0, 4) === year).map(entrySummary));
      });

      // Create a new entry, or update an existing one when `path` is given.
      server.middlewares.use('/admin/api/publish', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readBody(req);
          const markdown = (body.markdown || '').trim();
          // Title optional: blank → the local first-words heuristic (fallbackTitle).
          let title = (body.title || '').trim();
          if (!title) {
            if (!markdown) throw new Error('Title or content is required');
            title = fallbackTitle(markdown);
          }

          const editing = Boolean(body.path);

          // Astro's dev content store doesn't pick up the FIRST file added to a
          // previously-empty collection (a glob-loader limitation): getCollection
          // keeps reporting the `posts` collection "does not exist or is empty",
          // so the new entry's /posts/<slug> page 404s until the dev server is
          // restarted. Detect that empty→first transition here and restart the
          // server ourselves below, so the author never has to. Only matters for a
          // brand-new entry (an edit can't be the first file) and only when the
          // dir holds no posts yet, so normal publishing stays instant.
          let wasEmpty = false;
          if (!editing) {
            const postsDir = join(root(), 'src', 'content', 'posts');
            const existing = (await readdir(postsDir).catch(() => [])).filter((f) => f.endsWith('.md'));
            wasEmpty = existing.length === 0;
          }

          const iso = body.date || new Date().toISOString();
          const path = editing
            ? body.path
            : `src/content/posts/${iso.slice(0, 10)}-${slugify(title)}.md`;
          // Confine writes to the posts dir. `astro dev` has no auth and no Origin
          // check, and this writes straight to disk via join(root(), path) — so an
          // unvalidated `body.path` is an arbitrary file write a malicious page
          // could trigger by POSTing to localhost (a simple, no-preflight
          // cross-origin request). isValidPostPath also rejects `..` segments that
          // would climb out of join(root(), …).
          if (editing && !isValidPostPath(path)) throw new Error('Invalid path');

          // `tags`: honour the editor's explicit value; if it's absent (older
          // client), preserve the existing file's tags on edit (empty for new) so
          // an edit never silently drops them.
          const explicitTags =
            typeof body.tags === 'string' || Array.isArray(body.tags) ? parseTags(body.tags) : null;
          const existing = editing ? await readFile(join(root(), path), 'utf8').catch(() => '') : '';
          const tags = explicitTags !== null ? explicitTags : (editing ? parseTags(frontmatterTags(existing)) : []);
          const tagsLine = tags.length ? `tags: ${JSON.stringify(tags.join(', '))}\n` : '';

          // The filename holds the creation day (no `date` frontmatter field);
          // editing stamps a fresh `updated` (the client sends its local wall-clock
          // worn with a Z); a brand-new entry has none.
          const updatedLine = editing ? `updated: ${body.updated || new Date().toISOString()}\n` : '';
          const file = `---\ntitle: ${JSON.stringify(title)}\n${tagsLine}${updatedLine}---\n\n${markdown}\n`;
          await writeFile(join(root(), path), file, 'utf8');
          sendJson(res, 200, { ok: true, path, title, edited: editing });

          // First-ever entry (see wasEmpty above): restart so Astro re-syncs the
          // content collection. Done *after* responding, so the editor still gets
          // its success toast; the author then lands on the home (served from disk
          // here, so it's unaffected) while the server comes back, and by the time
          // they open the entry the collection exists. One-time cost on post #1.
          if (wasEmpty) {
            console.log('[dev-publish] first entry created — restarting dev server to sync the content collection');
            server.restart().catch((err) => console.error('[dev-publish] restart failed:', err));
          }
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });

      // Delete an entry file.
      server.middlewares.use('/admin/api/delete', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readBody(req);
          const path = body.path || '';
          if (!isValidPostPath(path)) throw new Error('Invalid path');
          await unlink(join(root(), path));
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });

      // Upload an image into public/uploads/ (served at /uploads/<name>).
      server.middlewares.use('/admin/api/upload', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readBody(req);
          if (!body.data) throw new Error('No file data');
          const filename = uploadFilename(body.name, body.type);
          if (!filename) throw new Error('Unsupported image type (png, jpg, gif, webp, avif)');
          const dir = join(root(), 'public', 'uploads');
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, filename), Buffer.from(body.data, 'base64'));
          sendJson(res, 200, { url: `/uploads/${filename}` });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });
    },
  };
}

// Static blog (Astro SSG); React is here only for the CodeMirror editor island.
// devPublish() emulates the editor's publish API for local authoring in dev.
// adminBuild() keeps the dev-only /admin editing surface out of production builds
// (drops the editor island, emits the /admin redirect) unless PUBLIC_ENABLE_EDITING
// is set — see src/lib/adminBuild.js.
export default defineConfig({
  integrations: [react(), adminBuild()],
  // remarkStripHtml removes any author-written raw HTML so prose renders as
  // Markdown only; remarkSandbox then turns ```js canvas|svg|d3 fences into live
  // iframe figures (src/lib/*). ORDER MATTERS: strip first, because remarkSandbox
  // emits its figures as raw-HTML nodes and would otherwise be stripped too.
  // Registered via `markdown.processor` (the non-deprecated path as of Astro
  // 6.4): `unified()` builds a processor that still applies all of Astro's
  // defaults — gfm, smartypants, Shiki — and just adds our remark plugins on top.
  markdown: { processor: unified({ remarkPlugins: [remarkStripHtml, remarkSandbox] }) },
  vite: { plugins: [devPublish()] },
});
