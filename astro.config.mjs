import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unified } from '@astrojs/markdown-remark';
import { remarkStripHtml } from './src/lib/remarkStripHtml.js';
import { remarkSandbox } from './src/lib/remarkSandbox.js';
// Keeps the dev-only /admin editing surface out of production builds.
import { adminBuild } from './src/lib/adminBuild.js';
import {
  entryBody,
  fallbackTitle,
  frontmatterDraft,
  frontmatterTags,
  frontmatterTitle,
  frontmatterUpdated,
  isValidPostPath,
  isValidUploadPath,
  parseTags,
  uniquePostPath,
  uploadRefs,
} from './src/lib/publish.js';
// Shared with the real /data endpoints; kept astro:content-free so this Vite config can import it.
import { entryCard, published, yearsOf } from './src/lib/entryData.js';
import { entryPreview, HOME_RECENT } from './src/lib/entryPreview.js';

// Dev-only: emulate the editor's /admin/api/* write routes against local disk (no server in prod).
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
      const fileExists = (p) => access(p).then(() => true, () => false);

      // astro dev never serves dist/, so mirror the Pagefind index from disk (else search 404s).
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
          next(); // not built yet → 404
        }
      });

      // Serve /data fresh from disk in dev — astro dev caches getStaticPaths, so a new year's first entry would 404 until restart.
      server.middlewares.use('/data', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const path = (req.url || '').split('?')[0];
        const wantsYears = path === '/years.json';
        const wantsHome = path === '/home.json';
        const yearMatch = /^\/(\d{4})\.json$/.exec(path);
        if (!wantsYears && !wantsHome && !yearMatch) return next(); // not a data route we mirror

        const dir = join(root(), 'src', 'content', 'posts');
        // Missing dir / empty repo → empty result, not an error.
        const files = (await readdir(dir).catch(() => []))
          .filter((f) => f.endsWith('.md'))
          .sort();
        // The minimal post-like shape entryCard/yearsOf expect (no astro:content here);
        // `body` mirrors Astro's collection entry so entryPreview derives the same cover/excerpt.
        const posts = await Promise.all(
          files.map(async (f) => {
            const id = f.slice(0, -3); // strip .md → the same id Astro's glob uses
            const text = await readFile(join(dir, f), 'utf8').catch(() => '');
            return { id, body: entryBody(text), data: { title: frontmatterTitle(text) || id, tags: frontmatterTags(text), draft: frontmatterDraft(text) } };
          }),
        );

        // Drafts are unlisted — drop them, as the prerendered /data endpoints do.
        const live = published(posts);
        if (wantsYears) return sendJson(res, 200, yearsOf(live));
        if (wantsHome) {
          const recent = [...live].sort((a, b) => b.id.localeCompare(a.id));
          const cards = recent.slice(0, HOME_RECENT + 1).map((p) => ({
            id: p.id,
            title: p.data.title,
            iso: `${p.id.slice(0, 10)}T00:00:00.000Z`,
            tags: parseTags(p.data.tags),
            ...entryPreview(p.body || ''),
          }));
          return sendJson(res, 200, { spotlight: cards[0] || null, recent: cards.slice(1) });
        }
        const year = yearMatch[1];
        return sendJson(res, 200, live.filter((p) => p.id.slice(0, 4) === year).map(entryCard));
      });

      // Read one entry's source for the single /admin/edit page (loaded at runtime, not prerendered per post).
      server.middlewares.use('/admin/api/entry', async (req, res, next) => {
        if (req.method !== 'GET') return next();
        try {
          const id = new URL(req.url, 'http://localhost').searchParams.get('post') || '';
          const path = `src/content/posts/${id}.md`;
          if (!isValidPostPath(path)) throw new Error('Invalid entry');
          const text = await readFile(join(root(), path), 'utf8').catch(() => null);
          if (text == null) return sendJson(res, 404, { error: 'Entry not found' });
          // The same fields the read view derives, so the editor restores exactly what it'll save.
          sendJson(res, 200, {
            markdown: entryBody(text),
            title: frontmatterTitle(text),
            tags: frontmatterTags(text),
            updated: frontmatterUpdated(text) || null,
            draft: frontmatterDraft(text),
            created: `${id.slice(0, 10)}T00:00:00.000Z`,
          });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });

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

          // Astro's dev store misses the first file added to an empty collection, so detect empty→first to restart below.
          let wasEmpty = false;
          if (!editing) {
            const postsDir = join(root(), 'src', 'content', 'posts');
            const existing = (await readdir(postsDir).catch(() => [])).filter((f) => f.endsWith('.md'));
            wasEmpty = existing.length === 0;
          }

          const srcPath = editing ? body.path : null;
          const existing = editing ? await readFile(join(root(), srcPath), 'utf8').catch(() => '') : '';

          const exists = (p) => fileExists(join(root(), p));
          let path, renameFrom = null;
          if (!editing) {
            const iso = body.date || new Date().toISOString();
            path = await uniquePostPath(iso, title, exists);
          } else {
            if (!isValidPostPath(srcPath)) throw new Error('Invalid path');
            const curDay = srcPath.slice(srcPath.lastIndexOf('/') + 1, srcPath.lastIndexOf('/') + 11);
            const destDay = body.date ? body.date.slice(0, 10) : curDay;
            path = srcPath;
            if (destDay !== curDay || title !== frontmatterTitle(existing)) {
              const dest = await uniquePostPath(`${destDay}T00:00:00.000Z`, title, (p) => p !== srcPath && exists(p));
              if (dest !== srcPath) { renameFrom = srcPath; path = dest; }
            }
          }

          // Honour the editor's explicit tags; if absent (older client), preserve existing so an edit never drops them.
          const explicitTags =
            typeof body.tags === 'string' || Array.isArray(body.tags) ? parseTags(body.tags) : null;
          const tags = explicitTags !== null ? explicitTags : (editing ? parseTags(frontmatterTags(existing)) : []);
          const tagsLine = tags.length ? `tags: ${JSON.stringify(tags.join(', '))}\n` : '';

          // Honour explicit draft; only write the line when true, so publishing naturally drops it.
          const draft =
            typeof body.draft === 'boolean' ? body.draft : (editing ? frontmatterDraft(existing) : false);
          const draftLine = draft ? 'draft: true\n' : '';

          // Editing stamps a fresh `updated` (client sends local wall-clock worn with a Z); new entries have none.
          const updatedLine = editing ? `updated: ${body.updated || new Date().toISOString()}\n` : '';
          const file = `---\ntitle: ${JSON.stringify(title)}\n${tagsLine}${draftLine}${updatedLine}---\n\n${markdown}\n`;

          const referenced = new Set(uploadRefs(markdown));
          const uploadsDir = join(root(), 'public', 'uploads');
          for (const img of Array.isArray(body.images) ? body.images : []) {
            if (!img || typeof img.path !== 'string' || typeof img.data !== 'string') continue;
            if (!isValidUploadPath(img.path)) throw new Error('Invalid image path');
            if (!referenced.has(img.path.slice('public/uploads/'.length))) continue;
            await mkdir(uploadsDir, { recursive: true });
            await writeFile(join(root(), img.path), Buffer.from(img.data, 'base64'));
          }
          await writeFile(join(root(), path), file, 'utf8');
          // Complete the rename: drop the old file, after the successful write, never before.
          if (renameFrom) await unlink(join(root(), renameFrom));
          if (editing) {
            for (const name of uploadRefs(existing)) {
              if (!referenced.has(name)) await unlink(join(uploadsDir, name)).catch(() => {});
            }
          }
          sendJson(res, 200, { ok: true, path, title, edited: editing });

          // First-ever entry: restart so Astro re-syncs the collection — after responding, so the editor still gets its toast.
          if (wasEmpty) {
            console.log('[dev-publish] first entry created — restarting dev server to sync the content collection');
            server.restart().catch((err) => console.error('[dev-publish] restart failed:', err));
          }
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });

      server.middlewares.use('/admin/api/delete', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const body = await readBody(req);
          const path = body.path || '';
          if (!isValidPostPath(path)) throw new Error('Invalid path');
          const existing = await readFile(join(root(), path), 'utf8').catch(() => '');
          await unlink(join(root(), path));
          for (const name of uploadRefs(existing)) {
            await unlink(join(root(), 'public', 'uploads', name)).catch(() => {});
          }
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      });

    },
  };
}

// React is here only for the CodeMirror editor island; the site is otherwise static SSG.
export default defineConfig({
  integrations: [react(), adminBuild()],
  // ORDER MATTERS: strip HTML first, else remarkSandbox's raw-HTML figures get stripped too.
  markdown: { processor: unified({ remarkPlugins: [remarkStripHtml, remarkSandbox] }) },
  vite: { plugins: [devPublish()] },
});
