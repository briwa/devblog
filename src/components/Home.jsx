import { useEffect, useMemo, useRef, useState, cloneElement } from "react";
import { ActivityCalendar } from "react-activity-calendar";
import Icon from "./Icon.jsx";
import MoreTags from "./MoreTags.jsx";
import YearDropdown from "./YearDropdown.jsx";
import { tagClass } from "../lib/tags.js";
import { CAN_CREATE, CAN_EDIT } from "../lib/permissions.js";
import { fmtDay, fmtFull as fmtFullDay } from "../lib/dates.js";

const PAGE_SIZE = 12;
const readYearParam = () => {
  const p = new URLSearchParams(window.location.search);
  return Number(p.get("year")) || null;
};

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

export default function Home() {
  const currentYear = new Date().getUTCFullYear();
  const [entryYears, setEntryYears] = useState([]);
  const [year, setYear] = useState(() => readYearParam() || currentYear);
  const autoPickYear = useRef(readYearParam() == null);
  const [page, setPage] = useState(0);
  const [activeTag, setActiveTag] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tag");
    return t ? t.trim() : null;
  });
  const [dark, setDark] = useState(false);
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(true);
  const showSkeleton = useGracefulLoading(loading);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/years.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((ys) => {
        if (cancelled || !Array.isArray(ys)) return;
        setEntryYears(ys);
        if (autoPickYear.current && ys.length) {
          autoPickYear.current = false;
          setYear(Math.max(...ys));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tip) return;
    const id = setTimeout(() => setTip(null), 3000);
    return () => clearTimeout(id);
  }, [tip?.date]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("year")) {
      url.searchParams.delete("year");
      window.history.replaceState({}, "", url);
    }
  }, []);
  useEffect(() => { setPage(0); }, [year]);

  function selectTag(tag) {
    setActiveTag(tag);
    setPage(0);
    const url = new URL(window.location.href);
    if (tag) url.searchParams.set("tag", tag);
    else url.searchParams.delete("tag");
    window.history.replaceState({}, "", url);
  }

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

  useEffect(() => {
    if (cache[year]) { setLoading(false); return; }
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
    if (!CAN_CREATE) return [...entryYears].sort((a, b) => b - a);
    const earliest = entryYears.length ? Math.min(currentYear, ...entryYears) : currentYear;
    const list = [];
    for (let y = currentYear; y >= earliest; y--) list.push(y);
    return list;
  }, [entryYears, currentYear]);

  const allEntries = cache[year] || [];
  const tagKey = activeTag ? activeTag.toLowerCase() : null;
  const entries = tagKey
    ? allEntries.filter((e) => (e.tags || []).some((t) => t.toLowerCase() === tagKey))
    : allEntries;
  const byDay = {};
  for (const e of entries) (byDay[e.iso.slice(0, 10)] ||= []).push(e);
  const sorted = [...entries].sort((a, b) => b.iso.localeCompare(a.iso));
  const data = [];
  if (!byDay[`${year}-01-01`]) data.push({ date: `${year}-01-01`, count: 0, level: 0 });
  for (const k of Object.keys(byDay).sort()) data.push({ date: k, count: byDay[k].length, level: Math.min(byDay[k].length, 4) });
  if (!byDay[`${year}-12-31`]) data.push({ date: `${year}-12-31`, count: 0, level: 0 });

  const renderBlock = (block, activity) => {
    const dayEntries = byDay[activity.date] || [];
    const href = dayEntries.length
      ? `/posts/${dayEntries[0].id}/`
      : CAN_CREATE ? `/admin/new?date=${activity.date}` : null;
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
          <YearDropdown
            years={years}
            value={year}
            onChange={(y) => { autoPickYear.current = false; setYear(y); }}
          />
        </div>
        {(CAN_CREATE || CAN_EDIT) && (
          <span className="hm-total">
            {CAN_CREATE && <a href="/admin/new/" className="hm-new">New</a>}
            {CAN_CREATE && CAN_EDIT && <span className="hm-sep" aria-hidden="true">|</span>}
            {CAN_EDIT && <a href="/admin/drafts/" className="hm-drafts">Drafts</a>}
          </span>
        )}
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
          labels={{ weekdays: ["S", "M", "T", "W", "T", "F", "S"] }}
          showTotalCount={false}
          renderBlock={renderBlock}
        />
      </div>

      {activeTag && (
        <div className="tag-filter">
          <span className="tag-filter-label">Tagged</span>
          <span className="tag">{activeTag}</span>
          <button className="tag-filter-clear" onClick={() => selectTag(null)} aria-label="Clear tag filter">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {loading || showSkeleton ? (
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
                      <span className="ml-tags">
                        {e.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className={tagClass(tag)}
                            title={tag}
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
              <>No entries.</>
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
