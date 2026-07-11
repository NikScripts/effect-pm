"use client";

// The top bar + mobile menu. Matches the Effect site: brand on the left, search +
// hamburger on the right (inside the one bar), and the hamburger opens a full-page
// overlay that takes over the viewport instead of a disclosure that pushes content
// down. On wide screens the hamburger/overlay are hidden — the persistent sidebar
// (rendered by the layout) does the job. Server passes the nav items as props.

import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import { GroupedNav } from "./GroupedNav.js";

const Icon = {
  search: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  menu: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  close: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

export function NavBar({ groups }: { groups: ReadonlyArray<NavGroup> }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Lock body scroll + close on Escape while the takeover is open.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openMenu = (focusSearch: boolean): void => {
    setOpen(true);
    if (focusSearch) requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <>
      <header className="topbar">
        <a className="brand" href="/">effect-pm</a>
        <div className="topbar-actions">
          <button type="button" className="icon-btn" aria-label="Search" onClick={() => openMenu(true)}>
            {Icon.search}
          </button>
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => (open ? setOpen(false) : openMenu(false))}
          >
            {open ? Icon.close : Icon.menu}
          </button>
        </div>
      </header>

      {open ? (
        <div className="menu-overlay" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="menu-inner">
            <input
              ref={inputRef}
              className="menu-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter chapters…"
              aria-label="Filter chapters"
            />
            <GroupedNav groups={groups} query={query} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
