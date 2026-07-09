import { useEffect, useState } from "react";
import { fmtDay, fmtFull } from "../lib/dates.js";
import { tagHref } from "../lib/tags.js";

function Cover({ cover }) {
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

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/home.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p className="jr-empty">Couldn’t load entries.</p>;
  if (!data) return <div className="jr-loading" aria-hidden="true" />;

  const { spotlight, recent } = data;
  if (!spotlight) return <p className="jr-empty">No entries yet.</p>;

  const play = (el, on) => el.querySelector("iframe")?.contentWindow?.postMessage({ __figplay: on }, "*");

  return (
    <div className="journal">
      <article className="jr-spotlight">
        <a className="jr-spot-card" href={`/posts/${spotlight.id}/`}>
          <div
            className={`jr-cover jr-spot-cover${spotlight.cover ? "" : " is-empty"}`}
            onMouseEnter={(e) => play(e.currentTarget, true)}
            onMouseLeave={(e) => play(e.currentTarget, false)}
          >
            <Cover cover={spotlight.cover} />
            <div className="jr-cover-shade" />
            <div className="jr-spot-meta">
              <div className="jr-eyebrow">{fmtFull(spotlight.iso)}</div>
              <h2 className="jr-spot-title">{spotlight.title}</h2>
            </div>
          </div>
        </a>
        {spotlight.excerpt && (
          <p className="jr-spot-excerpt">
            {spotlight.excerpt}{" "}
            <a className="jr-spot-more" href={`/posts/${spotlight.id}/`}>More →</a>
          </p>
        )}
        {spotlight.tags?.length > 0 && (
          <div className="hashtags jr-spot-tags">
            {spotlight.tags.map((tag) => (
              <a className="hashtag" key={tag} href={tagHref(tag)}>#{tag}</a>
            ))}
          </div>
        )}
      </article>

      {recent.length > 0 && (
        <>
          <div className="jr-rule" />
          <div className="jr-grid">
            {recent.map((e) => (
              <a className="jr-card" key={e.id} href={`/posts/${e.id}/`}>
                {e.cover ? (
                  <div
                    className="jr-cover jr-card-cover"
                    onMouseEnter={(ev) => play(ev.currentTarget, true)}
                    onMouseLeave={(ev) => play(ev.currentTarget, false)}
                  ><Cover cover={e.cover} /></div>
                ) : (
                  <p className="jr-card-excerpt">{e.excerpt}</p>
                )}
                <span className="jr-card-title">{e.title}</span>
                {e.tags?.length > 0 && (
                  <span className="hashtags jr-card-tags">
                    {e.tags.map((tag) => <span className="hashtag" key={tag}>#{tag}</span>)}
                  </span>
                )}
                <span className="jr-card-date">{fmtDay(e.iso)}</span>
              </a>
            ))}
          </div>
          <div className="jr-foot">
            <a className="jr-more jr-archive" href="/archive">More →</a>
          </div>
        </>
      )}
    </div>
  );
}
