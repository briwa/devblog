import { fmtDay } from "../lib/dates.js";
import Hashtags from "./Hashtags.jsx";

export function Cover({ cover }) {
  if (!cover) return null;
  if (cover.type === "image")
    return <img className="jr-cover-media" src={cover.src} alt={cover.alt || ""} loading="lazy" />;
  return (
    <iframe
      className="jr-cover-media jr-cover-frame"
      sandbox="allow-scripts"
      srcDoc={cover.srcdoc}
      title="figure preview"
      tabIndex={-1}
      scrolling="no"
      style={{ "--fig-ar": `${cover.w} / ${cover.h}` }}
    />
  );
}

export const play = (el, on) => el.querySelector("iframe")?.contentWindow?.postMessage({ __figplay: on }, "*");

// The little grid preview shared by the recent list and the timeline grid pages.
export default function PostCard({ entry: e }) {
  return (
    <div className="jr-card">
      <a className="jr-card-link" href={`/posts/${e.id}/`} aria-label={e.title} />
      {e.cover ? (
        <a
          className="jr-cover jr-card-cover"
          href={`/posts/${e.id}/`}
          tabIndex={-1}
          aria-hidden="true"
          onMouseEnter={(ev) => play(ev.currentTarget, true)}
          onMouseLeave={(ev) => play(ev.currentTarget, false)}
        >
          <Cover cover={e.cover} />
        </a>
      ) : (
        <p className="jr-card-excerpt">{e.excerpt}</p>
      )}
      <span className="jr-card-title">{e.title}</span>
      <Hashtags tags={e.tags} max={3} link className="jr-card-tags" />
      <span className="jr-card-date">{fmtDay(e.iso)}</span>
    </div>
  );
}
