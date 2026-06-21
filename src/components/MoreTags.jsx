import { useEffect, useRef, useState } from "react";
import { tagClass } from "../lib/tags.js";

export default function MoreTags({ tags, onPick }) {
  const [open, setOpen] = useState(false);
  const hideTimer = useRef(null);
  const dismissed = useRef(false);

  const show = () => {
    if (dismissed.current) return;
    clearTimeout(hideTimer.current);
    setOpen(true);
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 500);
  };
  const onLeave = () => { dismissed.current = false; scheduleHide(); };
  const dismiss = (ev) => {
    ev.preventDefault();   // don't follow the surrounding entry link
    ev.stopPropagation();
    clearTimeout(hideTimer.current);
    dismissed.current = true;
    setOpen(false);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <span
      className="ml-more"
      tabIndex={0}
      aria-label={`More tags: ${tags.join(", ")}`}
      onMouseEnter={show}
      onMouseLeave={onLeave}
      onFocus={show}
      onBlur={scheduleHide}
      onClick={dismiss}
    >
      ({tags.length} more…)
      <span className={`ml-more-pop${open ? " open" : ""}`} role="tooltip">
        {tags.map((tag) => (
          <span
            key={tag}
            className={tagClass(tag)}
            title={tag}
            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onPick?.(tag); }}
          ><span className="tag-label">{tag}</span></span>
        ))}
      </span>
    </span>
  );
}
