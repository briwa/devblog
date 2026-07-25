import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { CAN_CREATE, CAN_EDIT } from "../lib/permissions.js";

export default function EntryActions({ slug, date = null }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 300);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  // Under /admin every capability is on (it's the authoring area); public pages
  // follow the hide-controls flag so a deploy can suppress the FABs.
  const admin = window.location.pathname.startsWith("/admin");
  const canEdit = CAN_EDIT || admin;
  const canCreate = CAN_CREATE || admin;
  const showFab = canEdit || canCreate || scrolled;
  if (!showFab) return null;

  const backToTop = scrolled && (
    <button className="fab-btn" onClick={toTop} aria-label="Back to top" title="Back to top">
      <Icon name="chevronUp" size={19} />
    </button>
  );

  const topDivider = scrolled && <div className="fab-divider" aria-hidden="true" />;

  return (
    <div className="editor-fab" role="toolbar" aria-label="Entry actions">
      {backToTop}
      {(canEdit || canCreate) && (
        <>
          {topDivider}
          {canEdit && (
            <a className="fab-btn" href={`/admin/edit?post=${slug}`} aria-label="Edit entry" title="Edit entry">
              <Icon name="pencil" size={18} />
            </a>
          )}
          {canEdit && canCreate && <div className="fab-divider" aria-hidden="true" />}
          {canCreate && (
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
