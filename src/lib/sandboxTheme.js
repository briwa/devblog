// Figures are null-origin sandboxed iframes that can't read the page's --bg, so when the author
// sets no background the host posts the resolved theme colour in (see buildSrcdoc's themeSync).

export const figureBg = () => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();

export const pushFigureTheme = (win) => { if (win) win.postMessage({ __sbxBg: figureBg() }, "*"); };

// Re-push to every current frame whenever the theme flips — manual data-theme toggle or device change.
export function watchFigureTheme(frames) {
  const push = () => { for (const f of frames()) pushFigureTheme(f.contentWindow); };
  const obs = new MutationObserver(push);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", push);
  return () => { obs.disconnect(); mq.removeEventListener("change", push); };
}

// Pause a figure's animation loop whenever the reader can't see it — tab hidden, window unfocused, or
// scrolled off-screen — so idle figures stop burning CPU. Pushes {__figvis} in; the frame gates its rAF on it
// (see VIS_GATE in sandbox.js). Call sync() after new frames mount (they miss a push posted before they listen).
export function watchFigureVisibility(frames) {
  const onScreen = new WeakMap(); // frame → intersecting? (absent = assume visible until the observer reports)
  const pageAwake = () => document.visibilityState === "visible" && document.hasFocus();
  const send = (f) => f.contentWindow?.postMessage({ __figvis: (onScreen.get(f) ?? true) && pageAwake() }, "*");
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { onScreen.set(e.target, e.isIntersecting); send(e.target); }
  });
  const sync = () => { for (const f of frames()) { io.observe(f); send(f); } }; // observe is a no-op on a repeat
  const onPage = () => { for (const f of frames()) send(f); };
  document.addEventListener("visibilitychange", onPage);
  window.addEventListener("focus", onPage);
  window.addEventListener("blur", onPage);
  sync();
  return {
    sync,
    stop() {
      io.disconnect();
      document.removeEventListener("visibilitychange", onPage);
      window.removeEventListener("focus", onPage);
      window.removeEventListener("blur", onPage);
    },
  };
}
