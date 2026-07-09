import { tagHref } from "../lib/tags.js";

export default function Hashtags({ tags, max, link = false, className = "" }) {
  if (!tags?.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const extra = tags.length - shown.length;
  return (
    <span className={`hashtags ${className}`.trim()}>
      {shown.map((t) =>
        link
          ? <a className="hashtag" key={t} href={tagHref(t)}>#{t}</a>
          : <span className="hashtag" key={t}>#{t}</span>,
      )}
      {extra > 0 && <span className="hashtag hashtag-more">+{extra}</span>}
    </span>
  );
}
