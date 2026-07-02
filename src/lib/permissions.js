// What the current viewer is allowed to do — the single source of truth the UI
// gates its "write" affordances on (the header +, the heatmap's empty-day links,
// the entry's edit pencil, the new-entry +, and delete).
//
// Creating, editing and deleting entries is a **dev-only** convenience by default:
// the /admin editor routes and their /admin/api/{publish,upload,delete} writes
// (emulated by devPublish in astro.config.mjs) exist only under `astro dev`, so a
// production build is a read-only archive.
//
// To turn editing on for a real deployment, set the **`PUBLIC_ENABLE_EDITING=true`**
// build-time environment variable. That one switch flips everything coherently:
// the permissions below, whether the /admin pages are built (getStaticPaths in
// `src/pages/admin/[action].astro`), and whether the editor islands + the /admin
// redirect are kept out of the build (`src/lib/adminBuild.js`). NOTE: this only
// makes sense once a production write backend for /admin/api/* actually exists —
// there is none yet, so the UI would load but Save would fail. Set it as a genuine
// environment variable in your host's build settings (e.g. Cloudflare Pages), not
// just a local `.env`: it's read from `process.env` in the build config too, which
// a `.env`-only value may not reach.
const allowed = import.meta.env.DEV || import.meta.env.PUBLIC_ENABLE_EDITING === 'true';

// Split into named flags so call sites read clearly and the rule can later differ
// per action.
export const CAN_CREATE = allowed;
export const CAN_EDIT = allowed;
export const CAN_DELETE = allowed;

// Whether the editing surface exists at all — the /admin routes are built and the
// editor island is bundled. Same rule as the permissions; named separately so
// build-time gates read as intent ("is editing enabled") rather than a per-action
// capability.
export const EDITING_ENABLED = allowed;
