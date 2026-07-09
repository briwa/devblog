import Hashtags from "./Hashtags.jsx";

export default function PostRow({ href, title, tags, date }) {
  return (
    <a className="ar-row" href={href}>
      <span className="ar-row-main">
        <span className="ar-row-title">{title}</span>
        <Hashtags tags={tags} max={3} className="ar-row-tags" />
      </span>
      <span className="ar-row-date">{date}</span>
    </a>
  );
}
