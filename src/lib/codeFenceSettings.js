// Persisted UI settings for the code-fence editor (SandboxModal). One JSON blob under a single
// key so future settings share the slot — read/write are null-safe (disabled storage, SSR).
const KEY = "settings:code-fence";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function getCodeFenceSetting(name, fallback) {
  const v = readAll()[name];
  return v === undefined ? fallback : v;
}

export function setCodeFenceSetting(name, value) {
  try {
    const all = readAll();
    all[name] = value;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
