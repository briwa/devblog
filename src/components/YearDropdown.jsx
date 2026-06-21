import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

export default function YearDropdown({ years, value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (y) => { onChange(y); setOpen(false); };

  return (
    <div className="year-dd" ref={wrapRef}>
      <button
        type="button"
        className="year-dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value}</span>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={14} />
      </button>
      {open && (
        <ul className="year-dd-menu" role="listbox" aria-label="Year">
          {years.map((y) => (
            <li key={y} role="option" aria-selected={y === value}>
              <button
                type="button"
                className={y === value ? "active" : ""}
                onClick={() => pick(y)}
              >
                {y}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
