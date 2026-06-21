// What the current viewer is allowed to do — the single source of truth the UI
// gates its "write" affordances on (the header +, the heatmap's empty-day links,
// the entry's edit pencil, the new-entry +, and delete).
//
// Creating, editing and deleting entries are **dev-only** quality-of-life
// features: the /api/publish|upload|delete routes exist only under `astro dev`
// (emulated by devPublish in astro.config.mjs). A production build has no server
// to handle them, so it's read-only — every capability below is simply "are we in
// dev". They're split into three named flags so call sites read clearly and so the
// rule can later differ per action or per environment.
const allowed = import.meta.env.DEV;

export const CAN_CREATE = allowed;
export const CAN_EDIT = allowed;
export const CAN_DELETE = allowed;
