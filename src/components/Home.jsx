import { useEffect, useState } from "react";
import { fmtFull } from "../lib/dates.js";
import Hashtags from "./Hashtags.jsx";
import PostCard, { Cover, play } from "./PostCard.jsx";

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
  if (!data) return null;

  const { spotlight, recent } = data;
  if (!spotlight) return <p className="jr-empty">No entries yet.</p>;

  return (
    <div className="journal">
      <article className={`jr-spotlight${spotlight.cover ? "" : " is-textonly"}`}>
        {spotlight.cover ? (
          <a className="jr-spot-card" href={`/posts/${spotlight.id}/`}>
            <div
              className="jr-cover jr-spot-cover"
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
        ) : (
          <a className="jr-spot-head" href={`/posts/${spotlight.id}/`}>
            <div className="jr-eyebrow">{fmtFull(spotlight.iso)}</div>
            <h2 className="jr-spot-title">{spotlight.title}</h2>
          </a>
        )}
        {spotlight.excerpt && (
          <p className="jr-spot-excerpt">
            {spotlight.excerpt}{" "}
            <a className="jr-spot-more" href={`/posts/${spotlight.id}/`}>More →</a>
          </p>
        )}
        <Hashtags tags={spotlight.tags} max={6} link className="jr-spot-tags" />
      </article>

      {recent.length > 0 && (
        <>
          <div className="jr-rule" />
          <div className="jr-grid">
            {recent.map((e) => (
              <PostCard entry={e} key={e.id} />
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
