import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { CAN_CREATE, CAN_EDIT } from "../lib/capabilities.js";

// The floating action bar on a published entry's read view: a back-to-top button
// (once scrolled) plus the owner-only edit/new affordances.
//
// Editing is no longer an in-place ?edit toggle on this page — it's a dedicated
// /admin/* route (so the whole editing surface sits under one auth-wallable path;
// see astro.config.mjs). That makes these plain links, not React state, and keeps
// the heavy CodeMirror editor (EntryEditor) off the public entry bundle entirely.
// The capabilities gate them to dev, same as before: a production build renders
// none of them, so the entry stays a read-only archive.
export default function EntryActions({ slug, date = null }) {
  // The back-to-top button only appears once you've scrolled a bit.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // Render the bar only when there's something in it — the edit/new actions when
  // permitted, or just back-to-top once scrolled — never an empty bar.
  const showFab = CAN_EDIT || CAN_CREATE || scrolled;
  if (!showFab) return null;

  const backToTop = scrolled && (
    <button className="fab-btn" onClick={toTop} aria-label="Back to top" title="Back to top">
      <Icon name="chevronUp" size={19} />
    </button>
  );
  // The divider separating back-to-top from the actions travels with back-to-top,
  // so it's never left floating when back-to-top is absent.
  const topDivider = scrolled && <div className="fab-divider" aria-hidden="true" />;

  return (
    <div className="editor-fab" role="toolbar" aria-label="Entry actions">
      {backToTop}
      {(CAN_EDIT || CAN_CREATE) && (
        <>
          {topDivider}
          {CAN_EDIT && (
            <a className="fab-btn" href={`/admin/posts/${slug}/`} aria-label="Edit entry" title="Edit entry">
              <Icon name="pencil" size={18} />
            </a>
          )}
          {/* New entry pre-dated to THIS entry's day (the filename's YYYY-MM-DD,
              carried in `date`) — not today. The home heatmap opens the existing
              entry when you click a day that already has one, so this is the only
              way to add a *second* entry for that day. Falls back to today if
              `date` is somehow absent. Separated from the pencil by its own divider. */}
          {CAN_EDIT && CAN_CREATE && <div className="fab-divider" aria-hidden="true" />}
          {CAN_CREATE && (
            <a
              className="fab-btn fab-new"
              href={date ? `/admin/new?date=${date.slice(0, 10)}` : "/admin/new/"}
              aria-label="New entry for this day"
              title="New entry for this day"
            >
              <Icon name="plus" size={18} />
            </a>
          )}
        </>
      )}
    </div>
  );
}
