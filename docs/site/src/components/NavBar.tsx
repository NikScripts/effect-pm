"use client";

// The top bar + mobile menu. Brand on the left, search + hamburger on the right; the hamburger opens
// a full-page overlay takeover. On wide screens the hamburger/overlay are hidden — the persistent
// sidebar (rendered by the layout) does the job.
//
// Open/close is a NATIVE checkbox toggle driven by CSS `:checked`, NOT React state. The server-
// rendered `<input>`/`<label>` and the CSS work the instant the HTML lands, so the hamburger responds
// before (and without) hydration — the old `useState` toggle silently ate taps on twoslash-heavy
// pages while the island was still hydrating. The search filter inside stays a hydrated island; JS
// only ENHANCES here (body-scroll-lock fallback, Escape-to-close, focus-on-open, close-on-navigate).

import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import { GroupedNav } from "./GroupedNav.js";

const MENU_ID = "menu-toggle";

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
  const [query, setQuery] = React.useState("");
  const cbRef = React.useRef<HTMLInputElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const close = (): void => {
    const cb = cbRef.current;
    if (cb && cb.checked) {
      cb.checked = false;
      document.body.style.overflow = "";
    }
  };

  // Progressive enhancement only — the toggle itself is the native checkbox above. Here we mirror the
  // checkbox state into the things CSS can't do on its own: a body-scroll-lock fallback for browsers
  // without :has(), focus the filter on open, and Escape-to-close.
  React.useEffect(() => {
    const cb = cbRef.current;
    if (cb === null) return;
    const onChange = (): void => {
      document.body.style.overflow = cb.checked ? "hidden" : "";
      if (cb.checked) requestAnimationFrame(() => inputRef.current?.focus());
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    cb.addEventListener("change", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      cb.removeEventListener("change", onChange);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      <input ref={cbRef} type="checkbox" id={MENU_ID} className="menu-cb" aria-label="Toggle navigation menu" />
      <header className="topbar">
        <a className="brand" href="/">effect-pm</a>
        <div className="topbar-actions">
          <label htmlFor={MENU_ID} className="icon-btn" aria-label="Search">
            {Icon.search}
          </label>
          <label htmlFor={MENU_ID} className="icon-btn menu-btn">
            <span className="i-menu">{Icon.menu}</span>
            <span className="i-close">{Icon.close}</span>
          </label>
        </div>
      </header>

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
          <GroupedNav groups={groups} query={query} onNavigate={close} />
        </div>
      </div>
    </>
  );
}
