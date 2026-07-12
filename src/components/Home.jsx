import { useEffect, useMemo, useRef, useState } from "react";
import { fmtFull, fmtMonthYear } from "../lib/dates.js";
import Hashtags from "./Hashtags.jsx";
import PostCard, { Cover, play } from "./PostCard.jsx";

const RECENT = 3; // cards beside the spotlight on the "Today" page
const PER_PAGE = 9; // 3×3 grid on every other page
const LEAD = 1 + RECENT; // entries the spotlight + recent grid consume on the Today page
const LONG_PRESS_MS = 450;

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

const monthLabel = (key) => fmtMonthYear(`${key}-01T00:00:00.000Z`);

// Placeholder shaped like the Today page, the view that always loads first.
function HomeSkeleton() {
  const cardWidths = ["72%", "58%", "66%"];
  return (
    <div className="home" aria-hidden="true">
      <aside className="tl">
        <ol className="tl-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i}>
              <span className="tl-item">
                <span className="tl-node" />
                <span className="sk sk-line" style={{ width: `${70 - i * 8}%` }} />
              </span>
            </li>
          ))}
        </ol>
      </aside>
      <div className="journal">
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
    </div>
  );
}

export default function Home() {
  const [entries, setEntries] = useState(null); // null while loading
  const [error, setError] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(null); // "YYYY-MM"; null → Today
  const [expanded, setExpanded] = useState(false); // mobile: timeline labels revealed
  const [activeTag, setActiveTag] = useState(
    () => new URLSearchParams(window.location.search).get("tag")?.trim() || null,
  );
  const tlRef = useRef(null);
  const pressTimer = useRef(null);
  const longPressed = useRef(false);

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

  // Dismiss the expanded mobile timeline on outside tap / Escape.
  useEffect(() => {
    if (!expanded) return;
    const onDown = (e) => { if (!tlRef.current?.contains(e.target)) setExpanded(false); };
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const filtered = useMemo(() => {
    const all = entries || [];
    if (!activeTag) return all;
    const key = activeTag.toLowerCase();
    return all.filter((e) => (e.tags || []).some((t) => t.toLowerCase() === key));
  }, [entries, activeTag]);

  const monthSet = useMemo(() => new Set(filtered.map((e) => e.iso.slice(0, 7))), [filtered]);
  const monthsDesc = useMemo(() => [...monthSet].sort((a, b) => b.localeCompare(a)), [monthSet]);

  // The month in view: the reader's pick when it still has entries, otherwise the newest ("Today").
  const activeMonth = (selectedMonth && monthSet.has(selectedMonth) ? selectedMonth : monthsDesc[0]) || null;
  const isToday = activeMonth === monthsDesc[0];
  const monthItems = useMemo(
    () => filtered.filter((e) => e.iso.slice(0, 7) === activeMonth),
    [filtered, activeMonth],
  );

  // Pagination is scoped to the active month. Today leads with a spotlight; other months are pure grids.
  const pageCount = isToday
    ? monthItems.length <= LEAD ? 1 : 1 + Math.ceil((monthItems.length - LEAD) / PER_PAGE)
    : Math.max(1, Math.ceil(monthItems.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const showSpotlight = isToday && safePage === 0;

  useEffect(() => { setPage(0); setSelectedMonth(null); }, [activeTag]);

  function clearTag() {
    setActiveTag(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("tag");
    window.history.replaceState({}, "", url);
  }

  function selectMonth(key) {
    setSelectedMonth(key);
    setPage(0);
    setExpanded(false);
  }

  const startPress = () => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => { longPressed.current = true; setExpanded(true); }, LONG_PRESS_MS);
  };
  const cancelPress = () => { clearTimeout(pressTimer.current); };

  // A long-press that opened the panel must not also select the pressed month.
  function onItemClick(key) {
    if (longPressed.current) { longPressed.current = false; return; }
    selectMonth(key);
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

  const spotlight = monthItems[0];
  const recent = monthItems.slice(1, LEAD);
  const gridItems = isToday
    ? monthItems.slice(LEAD + (safePage - 1) * PER_PAGE, LEAD + safePage * PER_PAGE)
    : monthItems.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  return (
    <div className="home">
      <aside
        className="tl"
        ref={tlRef}
        data-expanded={expanded ? "true" : undefined}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onTouchCancel={cancelPress}
      >
        <ol className="tl-list" aria-label="Timeline">
          {monthsDesc.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                className={`tl-item${m === activeMonth ? " is-active" : ""}`}
                aria-current={m === activeMonth ? "true" : undefined}
                onClick={() => onItemClick(m)}
                title={monthLabel(m)}
              >
                <span className="tl-node" aria-hidden="true" />
                <span className="tl-label">{i === 0 ? "Today" : monthLabel(m)}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <div className="journal">
        {activeTag && (
          <div className="ar-tagfilter">
            <span className="ar-tagfilter-label">Tagged</span>
            <span className="hashtag">#{activeTag}</span>
            <button className="ar-tagfilter-clear" onClick={clearTag} aria-label="Clear tag filter">✕</button>
          </div>
        )}

        {showSpotlight ? (
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
            <h2 className="jr-monthhead">{monthLabel(activeMonth)}</h2>
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
    </div>
  );
}
