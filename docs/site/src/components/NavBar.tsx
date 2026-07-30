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
import { urls } from "../lib/siteRoutes.js";
import { GroupedNav } from "./GroupedNav.js";
import { SearchPanel, type SearchPanelControl } from "../islands/SearchPanel.js";
import { SearchModal } from "../islands/SearchModal.js";

const MENU_ID = "menu-toggle";

const Icon = {
  github: (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.5 7.5 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  ),
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

export function NavBar({
  groups,
  version,
}: {
  groups: ReadonlyArray<NavGroup>;
  version?: string;
}): React.ReactElement {
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
      if (e.key === "Escape") {
        close();
        return;
      }
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
        <div className="topbar-inner">
          <a className="brand" href={urls.home()}>
            Hyperlink
          </a>
          {version !== undefined && version !== "" ? (
            <a className="version-badge" href={urls.releases()}>
              v{version}
            </a>
          ) : null}
          <a
            className="icon-btn gh-btn"
            href="https://github.com/nikolasstow/Hyperlink"
            aria-label="GitHub repository"
            target="_blank"
            rel="noreferrer"
          >
            {Icon.github}
          </a>
          {/* desktop search lives in the header (hidden on narrow widths — the icon buttons take over) */}
          <SearchModal />
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
                const q = query.trim();
                close();
                window.location.assign(urls.search({ query: { q } }));
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
