"use client";

// Spotlight-style search (effect.website-style): the sidebar shows a search-field-shaped TRIGGER;
// clicking it — or ⌘K / Ctrl-K / "/" anywhere — opens a centered modal with the real input and
// the same SearchPanel the mobile overlay uses. Typing previews results; Enter with no selection
// goes to the full /search page; ↑/↓ + Enter opens the selected hit; Escape / backdrop closes.

import * as React from "react";
import { createPortal } from "react-dom";
import { SearchPanel, type SearchPanelControl } from "./SearchPanel.js";

export function SearchModal(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hint, setHint] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<SearchPanelControl | null>(null);

  // the shortcut hint renders post-hydration only (platform sniff can't happen on the server)
  React.useEffect(() => {
    setHint(/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");
  }, []);

  const close = React.useCallback((): void => {
    setOpen(false);
    setQuery("");
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmdK = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      const slash =
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(
          e.target instanceof HTMLElement &&
          (e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.isContentEditable)
        );
      if (cmdK || slash) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // focus lands when the dialog mounts; scroll-lock the page behind it
  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button type="button" className="search-trigger" onClick={() => setOpen(true)}>
        <span className="search-trigger-label">Search docs and API…</span>
        {hint !== "" ? <kbd className="search-kbd">{hint}</kbd> : null}
      </button>
      {open
        ? createPortal(
            <div
              className="search-modal-backdrop"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) close();
              }}
            >
              <div className="search-modal" role="dialog" aria-modal="true" aria-label="Search">
                <input
                  ref={inputRef}
                  className="menu-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      close();
                      return;
                    }
                    // the panel gets first claim (↑/↓ selection, Enter on a selected hit) …
                    if (panelRef.current?.handleKey(e) === true) return;
                    // … otherwise Enter → the full results page
                    if (e.key === "Enter" && query.trim() !== "") {
                      close();
                      window.location.assign(`/search?q=${encodeURIComponent(query.trim())}`);
                    }
                  }}
                  placeholder="Search docs and API…"
                  aria-label="Search docs and API"
                />
                <div className="search-modal-results">
                  <SearchPanel query={query} onNavigate={close} controlRef={panelRef} />
                  {query.trim() === "" ? (
                    <p className="search-note">
                      Type to search the docs, API reference, and glossary. ↑↓ to select, ↵ to open,
                      esc to close.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
