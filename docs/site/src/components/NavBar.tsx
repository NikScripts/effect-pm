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
import { SearchPanel, type SearchPanelControl } from "../islands/SearchPanel.js";

const MENU_ID = "menu-toggle";

const Icon = {
  search: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  menu: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  close: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

export function NavBar({ groups }: { groups: ReadonlyArray<NavGroup> }): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const cbRef = React.useRef<HTMLInputElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<SearchPanelControl | null>(null);

  const close = (): void => {
    const cb = cbRef.current;
    if (cb && cb.checked) {
      cb.checked = false;
      document.body.style.overflow = "";
    }
  };

  // Progressive enhancement only — the toggle itself is the native checkbox above. Here we mirror the
  // checkbox state into the things CSS can't do on its own: a body-scroll-lock fallback for browsers
  // without :has(), and Escape-to-close.
  React.useEffect(() => {
    const cb = cbRef.current;
    if (cb === null) return;
    const onChange = (): void => {
      // scroll-lock only — focusing the input is the search BUTTON's job (sync, in its tap);
      // the hamburger opens the nav without touching the field at all.
      document.body.style.overflow = cb.checked ? "hidden" : "";
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
      <input
        ref={cbRef}
        type="checkbox"
        id={MENU_ID}
        className="menu-cb"
        aria-label="Toggle navigation menu"
      />
      <header className="topbar">
        <a className="brand" href="/">
          effect-pm
        </a>
        <div className="topbar-actions">
          {/* A button, not a checkbox label: iOS only shows the keyboard when focus() runs
              synchronously inside the tap's call stack, so open + focus must happen inline here.
              (The hamburger keeps its deferred focus — opening the NAV shouldn't raise a keyboard.) */}
          <button
            type="button"
            className="icon-btn"
            aria-label="Search"
            onClick={() => {
              const cb = cbRef.current;
              if (cb !== null && !cb.checked) {
                cb.checked = true;
                document.body.style.overflow = "hidden";
              }
              inputRef.current?.focus();
            }}
          >
            {Icon.search}
          </button>
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
            onKeyDown={(e) => {
              // the panel gets first claim (↑/↓ selection, Enter on a selected hit) …
              if (panelRef.current?.handleKey(e) === true) return;
              // … otherwise Enter → the full results page; the panel below is the small preview.
              if (e.key === "Enter" && query.trim() !== "") {
                close();
                window.location.assign(`/search?q=${encodeURIComponent(query.trim())}`);
              }
            }}
            placeholder="Search docs and API…"
            aria-label="Search docs and API"
          />
          <SearchPanel query={query} onNavigate={close} controlRef={panelRef} />
          <GroupedNav groups={groups} query={query} onNavigate={close} />
        </div>
      </div>
    </>
  );
}
