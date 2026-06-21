// Editing is a dev-only convenience: there's no production write backend, so a prod build is a read-only archive.
const allowed = import.meta.env.DEV;

// Named per action so call sites read clearly and the rule can later differ per action.
export const CAN_CREATE = allowed;
export const CAN_EDIT = allowed;
export const CAN_DELETE = allowed;

// Whether the editing surface exists at all (routes built, editor island bundled) — named separately so build-time gates read as intent.
export const EDITING_ENABLED = allowed;
