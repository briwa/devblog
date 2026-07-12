import { useEffect, useRef, useState } from "react";

const VIEWS = [
  { key: "home", label: "Home", href: "/" },
  { key: "about", label: "About", href: "/about" },
  { key: "archive", label: "Archive", href: "/archive", divider: true },
];

export default function JournalNav({ current = "home" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = (VIEWS.find((v) => v.key === current) ?? VIEWS[0]).label;

  return (
    <div className="jn">
      <div className="jn-dd" ref={ref}>
        <button
          type="button"
          className="jn-dd-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span>{label}</span>
          <span className="jn-caret" aria-hidden="true" />
        </button>
        {open && (
          <ul className="jn-dd-menu" role="listbox" aria-label="View">
            {VIEWS.map((v) => (
              <li key={v.key} role="option" aria-selected={v.key === current} className={v.divider ? "jn-dd-divider" : ""}>
                <a className={v.key === current ? "active" : ""} href={v.href}>{v.label}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
