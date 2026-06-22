import { useEffect, useMemo, useRef, useState, cloneElement } from "react";
import { ActivityCalendar } from "react-activity-calendar";
import Icon from "./Icon.jsx";
import { tagClass } from "../lib/tags.js";
import { CAN_CREATE } from "../lib/capabilities.js";

const PAGE_SIZE = 12;
const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtFullDay = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// A post's back-link carries `?year=` so we can restore its year context on
// arrival. We read it once, then strip it to keep the home URL clean.
const readYearParam = () => {
  const p = new URLSearchParams(window.location.search);
  return Number(p.get("year")) || null;
};

// Gate a loading skeleton so it never flickers: show it only if `loading`
// outlasts `delay` (quick fetches skip it entirely), and once shown hold it at
// least `minVisible` (so it can't blink out instantly). Net effect — the
// skeleton either shows fully or not at all.
function useGracefulLoading(loading, { delay = 150, minVisible = 400 } = {}) {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (loading && !shown) {
      const t = setTimeout(() => { shownAt.current = Date.now(); setShown(true); }, delay);
      return () => clearTimeout(t);
    }
    if (!loading && shown) {
      const remaining = Math.max(0, minVisible - (Date.now() - shownAt.current));
      const t = setTimeout(() => setShown(false), remaining);
      return () => clearTimeout(t);
    }
  }, [loading, shown, delay, minVisible]);
  return shown;
}

// The "(n more…)" label beside a list title: hovering reveals the rest of the
// tags in a popup; a click anywhere in it just dismisses the popup (it never
// opens the post, even though it sits inside the entry link). Open state is in
// JS — a CSS-only hover popup can't dismiss-on-click while the pointer is still
// over it, and focus-reveal alone left it stuck open after a click.
function MoreTags({ tags, onPick }) {
  const [open, setOpen] = useState(false);
  const hideTimer = useRef(null);
  const dismissed = useRef(false); // clicked-closed; stays shut until the pointer leaves

  const show = () => {
    if (dismissed.current) return;
    clearTimeout(hideTimer.current);
    setOpen(true);
  };
  // Close on a delay so there's time to cross the small gap into the popup.
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
            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onPick(tag); }}
          ><span className="tag-label">{tag}</span></span>
        ))}
      </span>
    </span>
  );
}

// Main page: GitHub-style heatmap + that year's entry list. Entries load per
// year (cached) so the home payload doesn't grow with the whole archive.
export default function Home() {
  const currentYear = new Date().getUTCFullYear();
  const [entryYears, setEntryYears] = useState([]); // years with entries; fetched below
  const [year, setYear] = useState(() => readYearParam() || currentYear);
  // With no explicit ?year, default to the most recent year that actually has
  // entries (resolved once the year list loads) rather than today's year, so a
  // reader whose newest entry is years back doesn't land on an empty year.
  const autoPickYear = useRef(readYearParam() == null);
  const [page, setPage] = useState(0);
  // Active tag filter (from ?tag, kept in the URL so it survives refresh/share).
  // It persists across year switches — only the year's entry set is re-filtered.
  const [activeTag, setActiveTag] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tag");
    return t ? t.trim() : null;
  });
  const [dark, setDark] = useState(false);
  const [cache, setCache] = useState({}); // year -> entries[]
  const [loading, setLoading] = useState(true);
  const showSkeleton = useGracefulLoading(loading);
  const [tip, setTip] = useState(null); // calendar hover tooltip: { date, titles, x, y }

  // The set of years is fetched at runtime (not baked into the page) so the
  // static HTML doesn't grow with the archive.
  useEffect(() => {
    let cancelled = false;
    fetch("/data/years.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((ys) => {
        if (cancelled || !Array.isArray(ys)) return;
        setEntryYears(ys);
        // Land on the most recent year with entries, unless the viewer arrived
        // with a ?year or has already picked one.
        if (autoPickYear.current && ys.length) {
          autoPickYear.current = false;
          setYear(Math.max(...ys));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Auto-dismiss the tooltip a few seconds after it appears (or when the cell
  // changes); leaving a cell clears it immediately via onMouseLeave.
  useEffect(() => {
    if (!tip) return;
    const id = setTimeout(() => setTip(null), 3000);
    return () => clearTimeout(id);
  }, [tip?.date]);

  // Strip the incoming ?year param once so the home URL stays clean.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("year")) {
      url.searchParams.delete("year");
      window.history.replaceState({}, "", url);
    }
  }, []);
  useEffect(() => { setPage(0); }, [year]);

  // Apply (or clear, with null) a tag filter: update state, the URL, and reset
  // to the first page. The selected year is left as-is — switching years keeps
  // the filter.
  function selectTag(tag) {
    setActiveTag(tag);
    setPage(0);
    const url = new URL(window.location.href);
    if (tag) url.searchParams.set("tag", tag);
    else url.searchParams.delete("tag");
    window.history.replaceState({}, "", url);
  }

  // Follow the site theme.
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () => { const a = root.getAttribute("data-theme"); setDark(a ? a === "dark" : mq.matches); };
    compute();
    mq.addEventListener("change", compute);
    const obs = new MutationObserver(compute);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mq.removeEventListener("change", compute); obs.disconnect(); };
  }, []);

  // Load the selected year's entries once.
  useEffect(() => {
    if (cache[year]) { setLoading(false); return; }
    // Skip the fetch for a year with no entries — but only once the year list has
    // actually loaded. It's fetched async (starts empty), so guarding on an empty
    // list would wrongly blank out the current year on first paint before it
    // arrives. While the list is still empty we just fetch and let the result decide.
    if (entryYears.length && !entryYears.includes(year)) { setCache((c) => ({ ...c, [year]: [] })); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/data/${year}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((entries) => { if (!cancelled) { setCache((c) => ({ ...c, [year]: entries })); setLoading(false); } })
      .catch(() => { if (!cancelled) { setCache((c) => ({ ...c, [year]: [] })); setLoading(false); } });
    return () => { cancelled = true; };
  }, [year]);

  const years = useMemo(() => {
    // A read-only (production) build can't create entries, so the year selector
    // shows only years that actually have entries (newest first). In dev the
    // author gets the full continuous range down to the earliest year — including
    // empty/current years — so they can jump to any year to start writing.
    if (!CAN_CREATE) return [...entryYears].sort((a, b) => b - a);
    const earliest = entryYears.length ? Math.min(currentYear, ...entryYears) : currentYear;
    const list = [];
    for (let y = currentYear; y >= earliest; y--) list.push(y);
    return list;
  }, [entryYears, currentYear]);

  const allEntries = cache[year] || [];
  // When a tag filter is active, the heatmap, list and count all reflect only
  // entries carrying that tag (case-insensitive). Clearing it restores the full
  // year. Year-switching re-runs this against the newly selected year.
  const tagKey = activeTag ? activeTag.toLowerCase() : null;
  const entries = tagKey
    ? allEntries.filter((e) => (e.tags || []).some((t) => t.toLowerCase() === tagKey))
    : allEntries;
  const byDay = {};
  for (const e of entries) (byDay[e.iso.slice(0, 10)] ||= []).push(e);
  const sorted = [...entries].sort((a, b) => b.iso.localeCompare(a.iso));

  // Calendar data: Jan 1 / Dec 31 bounds + a point per entry-day (deduped).
  const data = [];
  if (!byDay[`${year}-01-01`]) data.push({ date: `${year}-01-01`, count: 0, level: 0 });
  for (const k of Object.keys(byDay).sort()) data.push({ date: k, count: byDay[k].length, level: Math.min(byDay[k].length, 4) });
  if (!byDay[`${year}-12-31`]) data.push({ date: `${year}-12-31`, count: 0, level: 0 });

  const renderBlock = (block, activity) => {
    const dayEntries = byDay[activity.date] || [];
    // A day with entries opens the first one and lists every title in the
    // tooltip; an empty day starts a new entry pre-dated to that day — except in a
    // read-only (production) build, where there's no writing, so it's inert.
    const href = dayEntries.length
      ? `/posts/${dayEntries[0].id}/`
      : CAN_CREATE ? `/posts/new?date=${activity.date}` : null;
    const titles = dayEntries.map((e) => e.title);
    const showTip = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ date: fmtFullDay(activity.date), titles, x: r.left + r.width / 2, y: r.top });
    };
    return cloneElement(block, {
      onClick: () => { if (href) window.location.href = href; },
      onMouseEnter: showTip,
      onMouseLeave: () => setTip(null),
      "aria-label": titles.length ? `${fmtFullDay(activity.date)}: ${titles.join(", ")}` : fmtFullDay(activity.date),
      style: { ...(block.props.style || {}), cursor: href ? "pointer" : "default" },
    });
  };

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE);

  return (
    <div className="home">
      <div className="hm-head">
        <div className="hm-years">
          {years.map((y) => (
            <button key={y} className={y === year ? "active" : ""} onClick={() => { autoPickYear.current = false; setYear(y); }}>{y}</button>
          ))}
        </div>
        <span className="hm-total">
          {loading ? "…" : `${sorted.length} ${sorted.length === 1 ? "entry" : "entries"} in ${year}`}
          {/* The header "+" is gone; the only place to start an entry is here,
              beside the count it pertains to. Owner-only (CAN_CREATE). */}
          {CAN_CREATE && (
            <>
              <span className="hm-sep" aria-hidden="true">|</span>
              <a href="/posts/new/" className="hm-new">New</a>
            </>
          )}
        </span>
      </div>

      <div className="hm-cal">
        <ActivityCalendar
          data={data}
          loading={loading}
          colorScheme={dark ? "dark" : "light"}
          theme={{ light: ["#eae8e2", "#b1442e"], dark: ["#26262c", "#e07a5f"] }}
          blockSize={10}
          blockMargin={2}
          fontSize={11}
          showWeekdayLabels={["mon", "wed", "fri"]}
          // Single-letter weekday labels keep the gutter tight (the heatmap is
          // mirrored, so this gutter sits on the right). Sun→Sat order.
          labels={{ weekdays: ["S", "M", "T", "W", "T", "F", "S"] }}
          showTotalCount={false}
          renderBlock={renderBlock}
        />
      </div>

      {activeTag && (
        // Active-filter pill with a clear (×). The chip is uncolored like the
        // rest; clicking the × removes the filter and the ?tag param.
        <div className="tag-filter">
          <span className="tag-filter-label">Tagged</span>
          <span className="tag">{activeTag}</span>
          <button className="tag-filter-clear" onClick={() => selectTag(null)} aria-label="Clear tag filter">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {loading || showSkeleton ? (
        // The list region keeps a fixed min-height (see .month-region) the whole
        // time it's loading — including the brief anti-flicker grace before the
        // skeleton shows — so the skeleton, a full page, a short page and the
        // pager all occupy the same vertical space and nothing below ever shifts.
        // The skeleton rows themselves only render once showSkeleton is true.
        <div className="month-region">
          {showSkeleton && (
            <ul className="month-list month-skeleton" aria-hidden="true">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <li key={i}>
                  <span className="sk-row">
                    <span className="sk-bar" style={{ width: `${45 + ((i * 13) % 40)}%` }} />
                    <span className="sk-bar sk-date" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        sorted.length > 0 ? (
          <div className="month-region">
            <ul className="month-list">
              {sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map((e) => (
                <li key={e.id}>
                  <a href={`/posts/${e.id}/`}>
                    <span className="ml-title">{e.title}</span>
                    {e.tags && e.tags.length > 0 && (
                      // Up to two chips to the right of the title; the rest fold
                      // into a "(n more…)" label that reveals them on hover/focus.
                      <span className="ml-tags">
                        {e.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className={tagClass(tag)}
                            title={tag}
                            // Filter instead of opening the post (the chip is
                            // inside the entry link).
                            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); selectTag(tag); }}
                          ><span className="tag-label">{tag}</span></span>
                        ))}
                        {e.tags.length > 2 && <MoreTags tags={e.tags.slice(2)} onPick={selectTag} />}
                      </span>
                    )}
                    <span className="ml-date">{fmtDay(e.iso)}</span>
                  </a>
                </li>
              ))}
            </ul>
            {pageCount > 1 && (
              <div className="pager">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Newer entries" title="Newer">
                  <Icon name="chevronLeft" size={18} />
                </button>
                <span className="pager-info">{page + 1} / {pageCount}</span>
                <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} aria-label="Older entries" title="Older">
                  <Icon name="chevronRight" size={18} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <p className="month-empty">
            {activeTag ? (
              <>No entries tagged “{activeTag}” in {year}. <button className="link-btn" onClick={() => selectTag(null)}>Clear filter</button></>
            ) : (
              <>No entries in {year}.</>
            )}
          </p>
        ))}

      {tip && (
        <div className="cal-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <div className="cal-tip-date">{tip.date}</div>
          {tip.titles.length > 0 && (
            <ul className="cal-tip-list">
              {tip.titles.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
