import { useEffect, useMemo, useRef, useState } from "react";
import { fmtFull, fmtMonthYear } from "../lib/dates.js";
import Hashtags from "./Hashtags.jsx";
import PostCard, { Cover, play } from "./PostCard.jsx";

const RECENT = 3; // cards beside the spotlight on the first page
const PER_PAGE = 9; // 3×3 grid on every later page
const LEAD = 1 + RECENT; // entries consumed by the spotlight + first grid
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

// Which page holds the entry at flat index `i`: page 0 carries the spotlight + first grid, the rest 9 each.
const pageForIndex = (i) => (i < LEAD ? 0 : 1 + Math.floor((i - LEAD) / PER_PAGE));

// Placeholder shaped like the spotlight page (page 0), the view that always loads first.
function HomeSkeleton() {
  const cardWidths = ["72%", "58%", "66%"];
  return (
    <div className="journal" aria-hidden="true">
      <article className="jr-spotlight">
        <div className="sk sk-spot-cover" />
        <div className="sk sk-line" style={{ width: "92%", marginTop: "1.35rem" }} />
        <div className="sk sk-line" style={{ width: "64%", marginTop: "0.6rem" }} />
        <div className="sk sk-line" style={{ width: "28%", marginTop: "1rem" }} />
      </article>
      <div className="jr-rule" />
      <div className="jr-grid">
        {cardWidths.map((w, i) => (
          <div className="jr-card" key={i}>
            <div className="sk sk-card-cover" />
            <div className="sk sk-line" style={{ width: w }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [entries, setEntries] = useState(null); // null while loading
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [ddOpen, setDdOpen] = useState(false);
  const [viewYear, setViewYear] = useState(null);
  const [activeTag, setActiveTag] = useState(
    () => new URLSearchParams(window.location.search).get("tag")?.trim() || null,
  );
  const ddRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const years = await fetch("/data/years.json").then((r) => (r.ok ? r.json() : Promise.reject()));
        const lists = await Promise.all(
          (Array.isArray(years) ? years : []).map((y) =>
            fetch(`/data/${y}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
          ),
        );
        if (!cancelled) setEntries(lists.flat().sort((a, b) => b.iso.localeCompare(a.iso)));
      } catch {
        if (!cancelled) setError(true);
      }
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

  const pageCount = filtered.length <= LEAD ? 1 : 1 + Math.ceil((filtered.length - LEAD) / PER_PAGE);
  const safePage = Math.min(page, pageCount - 1);

  const monthSet = useMemo(() => new Set(filtered.map((e) => e.iso.slice(0, 7))), [filtered]);
  const years = useMemo(
    () => [...new Set(filtered.map((e) => Number(e.iso.slice(0, 4))))].sort((a, b) => a - b),
    [filtered],
  );

  // On a grid page the calendar tracks the month of the first card shown.
  const gridStart = LEAD + (safePage - 1) * PER_PAGE;
  const activeMonth = safePage === 0 ? null : filtered[gridStart]?.iso.slice(0, 7) || null;

  useEffect(() => { setPage(0); }, [activeTag]);

  function clearTag() {
    setActiveTag(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tag");
    window.history.replaceState({}, "", url);
  }

  // Jump to whichever page holds that month's newest entry.
  function pickMonth(key) {
    const idx = filtered.findIndex((e) => e.iso.slice(0, 7) === key);
    if (idx >= 0) setPage(pageForIndex(idx));
    setDdOpen(false);
  }

  if (error) return <p className="jr-empty">Couldn’t load entries.</p>;
  if (entries === null) return <HomeSkeleton />;

  if (filtered.length === 0)
    return (
      <p className="jr-empty">
        {activeTag ? (
          <>No entries tagged “{activeTag}”. <button className="link-btn" onClick={clearTag}>Clear filter</button></>
        ) : (
          <>No entries yet.</>
        )}
      </p>
    );

  const spotlight = filtered[0];
  const recent = filtered.slice(1, LEAD);
  const gridItems = filtered.slice(gridStart, gridStart + PER_PAGE);

  return (
    <div className="journal">
      {activeTag && (
        <div className="ar-tagfilter">
          <span className="ar-tagfilter-label">Tagged</span>
          <span className="hashtag">#{activeTag}</span>
          <button className="ar-tagfilter-clear" onClick={clearTag} aria-label="Clear tag filter">✕</button>
        </div>
      )}

      {safePage === 0 ? (
        <>
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
                {spotlight.excerpt}{"  "}
                <a className="jr-spot-more" href={`/posts/${spotlight.id}/`}>...more →</a>
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
            </>
          )}
        </>
      ) : (
        <>
          <div className="ar-head">
            <div className="ar-period" ref={ddRef}>
              <button
                type="button"
                className="ar-period-trigger"
                aria-haspopup="dialog"
                aria-expanded={ddOpen}
                onClick={() => {
                  setViewYear(Number(activeMonth?.slice(0, 4)) || years[years.length - 1]);
                  setDdOpen((o) => !o);
                }}
              >
                <span>{activeMonth ? fmtMonthYear(`${activeMonth}-01T00:00:00.000Z`) : "Browse"}</span>
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
          </div>

          <div className="jr-grid">
            {gridItems.map((e) => (
              <PostCard key={e.id} entry={e} />
            ))}
          </div>
        </>
      )}

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
    </div>
  );
}
