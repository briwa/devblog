// What the current viewer is allowed to do — the single source of truth the UI
// gates its "write" affordances on (the header +, the heatmap's empty-day links,
// the entry's edit pencil, the new-entry +, and delete).
//
// Creating, editing and deleting entries is a **dev-only** convenience: the /admin
// editor routes and their /admin/api/{publish,upload,delete} writes (emulated by
// devPublish in astro.config.mjs) exist only under `astro dev`. A production build
// is always a read-only archive — there is no production write backend for
// /admin/api/*, so editing is deliberately confined to local authoring.
const allowed = import.meta.env.DEV;

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
