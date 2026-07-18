const KEY = "sandbox-draft"; // one slot — only one sandbox modal is ever open at a time
const TTL = 24 * 60 * 60 * 1000; // matches the entry draft: discarded after a day

// Restore only if the slot belongs to this modal (same entry + block); a mismatch or stale slot drops it.
export function loadSandboxDraft(key) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { key: savedKey, savedAt, data } = JSON.parse(raw);
    if (savedKey !== key || !savedAt || Date.now() - savedAt > TTL) {
      localStorage.removeItem(KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function saveSandboxDraft(key, data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ key, savedAt: Date.now(), data }));
  } catch {}
}

export function clearSandboxDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
