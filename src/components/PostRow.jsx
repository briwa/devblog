import Hashtags from "./Hashtags.jsx";

export default function PostRow({ href, title, tags, date }) {
  return (
    <div className="ar-row">
      <a className="ar-row-link" href={href} aria-label={title} />
      <span className="ar-row-main">
        <span className="ar-row-title">{title}</span>
        <Hashtags tags={tags} max={3} link className="ar-row-tags" />
      </span>
      <span className="ar-row-date">{date}</span>
    </div>
  );
}
