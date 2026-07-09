import { useEffect, useMemo, useRef, useState } from "react";
import { CAN_CREATE, CAN_EDIT } from "../lib/permissions.js";
import { fmtDay, fmtMonthYear } from "../lib/dates.js";
import PostRow from "./PostRow.jsx";

const PAGE_SIZE = 8;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ChevronL = () => (
  <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
    <path d="M6 1 1 6l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronR = () => (
  <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
    <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Archive() {
  const [entries, setEntries] = useState(null); // null while loading
  const [page, setPage] = useState(0);
  const [ddOpen, setDdOpen] = useState(false);
  const [viewYear, setViewYear] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null); // "YYYY-MM"; null → newest with entries
  const [activeTag, setActiveTag] = useState(
    () => new URLSearchParams(window.location.search).get("tag")?.trim() || null,
  );
  const ddRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const years = await fetch("/data/years.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const lists = await Promise.all(
        (Array.isArray(years) ? years : []).map((y) =>
          fetch(`/data/${y}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        ),
      );
      if (cancelled) return;
      setEntries(lists.flat().sort((a, b) => b.iso.localeCompare(a.iso)));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ddOpen) return;
    const onClick = (e) => { if (!ddRef.current?.contains(e.target)) setDdOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setDdOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [ddOpen]);

  const filtered = useMemo(() => {
    const all = entries || [];
    if (!activeTag) return all;
    const key = activeTag.toLowerCase();
    return all.filter((e) => (e.tags || []).some((t) => t.toLowerCase() === key));
  }, [entries, activeTag]);

  const monthSet = useMemo(() => new Set(filtered.map((e) => e.iso.slice(0, 7))), [filtered]);
  const years = useMemo(
    () => [...new Set(filtered.map((e) => Number(e.iso.slice(0, 4))))].sort((a, b) => a - b),
    [filtered],
  );

  const activeMonth = selectedMonth && monthSet.has(selectedMonth) ? selectedMonth : filtered[0]?.iso.slice(0, 7) || null;
  const heading = activeMonth ? fmtMonthYear(`${activeMonth}-01T00:00:00.000Z`) : null;

  const monthItems = useMemo(
    () => filtered.filter((e) => e.iso.slice(0, 7) === activeMonth),
    [filtered, activeMonth],
  );
  const pageCount = Math.max(1, Math.ceil(monthItems.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = monthItems.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setPage(0); }, [activeMonth, activeTag]);

  function clearTag() {
    setActiveTag(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tag");
    window.history.replaceState({}, "", url);
  }

  function pickMonth(key) {
    setSelectedMonth(key);
    setDdOpen(false);
  }

  return (
    <div className="archive">
      <div className="ar-head">
        <div className="ar-period" ref={ddRef}>
          <button
            type="button"
            className="ar-period-trigger"
            aria-haspopup="dialog"
            aria-expanded={ddOpen}
            disabled={!heading}
            onClick={() => {
              setViewYear(Number(activeMonth?.slice(0, 4)) || years[years.length - 1]);
              setDdOpen((o) => !o);
            }}
          >
            <span>{heading || "Archive"}</span>
            <span className="ar-caret" aria-hidden="true" />
          </button>
          {ddOpen && years.length > 0 && (
            <div className="ar-monthpicker" role="dialog" aria-label="Choose month">
              <div className="ar-mp-head">
                <button
                  type="button"
                  className="ar-mp-nav"
                  disabled={viewYear <= years[0]}
                  onClick={() => setViewYear((y) => y - 1)}
                  aria-label="Previous year"
                >
                  <ChevronL />
                </button>
                <span className="ar-mp-year">{viewYear}</span>
                <button
                  type="button"
                  className="ar-mp-nav"
                  disabled={viewYear >= years[years.length - 1]}
                  onClick={() => setViewYear((y) => y + 1)}
                  aria-label="Next year"
                >
                  <ChevronR />
                </button>
              </div>
              <div className="ar-mp-grid">
                {MONTHS.map((m, i) => {
                  const key = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button
                      type="button"
                      key={m}
                      className={`ar-mp-month${key === activeMonth ? " selected" : ""}`}
                      disabled={!monthSet.has(key)}
                      onClick={() => pickMonth(key)}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {(CAN_CREATE || CAN_EDIT) && (
          <span className="ar-admin">
            {CAN_CREATE && <a href="/admin/new/" className="hm-new">New</a>}
            {CAN_CREATE && CAN_EDIT && <span className="hm-sep" aria-hidden="true">|</span>}
            {CAN_EDIT && <a href="/admin/drafts/" className="hm-drafts">Drafts</a>}
          </span>
        )}
      </div>

      {activeTag && (
        <div className="ar-tagfilter">
          <span className="ar-tagfilter-label">Tagged</span>
          <span className="hashtag">#{activeTag}</span>
          <button className="ar-tagfilter-clear" onClick={clearTag} aria-label="Clear tag filter">✕</button>
        </div>
      )}

      {entries === null ? (
        <div className="ar-list" aria-hidden="true">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <div className="ar-row ar-row-skeleton" key={i}>
              <span className="ar-sk" style={{ width: `${45 + ((i * 13) % 40)}%` }} />
              <span className="ar-sk ar-sk-date" />
            </div>
          ))}
        </div>
      ) : pageItems.length === 0 ? (
        <p className="ar-empty">
          {activeTag ? (
            <>No entries tagged “{activeTag}”. <button className="link-btn" onClick={clearTag}>Clear filter</button></>
          ) : (
            <>No entries yet.</>
          )}
        </p>
      ) : (
        <>
          <div className="ar-list">
            {pageItems.map((e) => (
              <PostRow key={e.id} href={`/posts/${e.id}/`} title={e.title} tags={e.tags} date={fmtDay(e.iso)} />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="ar-pager">
              <button
                className="ar-pager-btn"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Newer entries"
              >
                <ChevronL />
              </button>
              <span className="ar-pager-info">{safePage + 1} / {pageCount}</span>
              <button
                className="ar-pager-btn"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                aria-label="Older entries"
              >
                <ChevronR />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
