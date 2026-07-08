const KEY = "editor-draft"; // one shared slot, owned by whichever editor is open
const TTL = 24 * 60 * 60 * 1000; // progress is discarded after a day

// Restore only if the slot belongs to this editor; a mismatch (or stale/expired) drops it
export function loadDraft(id) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { id: savedId, savedAt, data } = JSON.parse(raw);
    if (savedId !== id || !savedAt || Date.now() - savedAt > TTL) {
      localStorage.removeItem(KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function saveDraft(id, data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id, savedAt: Date.now(), data }));
  } catch {}
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
