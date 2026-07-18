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
