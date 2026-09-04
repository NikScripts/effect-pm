"use client";

// `?` opens a small keyboard-shortcuts card (outside editable fields); Escape / backdrop closes.

import * as React from "react";
import { createPortal } from "react-dom";

const rows: ReadonlyArray<readonly [string, string]> = [
  ["⌘K / Ctrl K", "open search anywhere"],
  ["/", "open search (outside a field)"],
  ["↑ ↓", "select a search result"],
  ["↵", "open it — or with nothing selected, the full results page"],
  ["esc", "close search / this card"],
  ["?", "this card"],
];

export function ShortcutsHelp(): React.ReactElement | null {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (
        e.key === "?" &&
        !(
          e.target instanceof HTMLElement &&
          (e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.isContentEditable)
        )
      ) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return createPortal(
    <div
      className="search-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="search-modal shortcuts-card" role="dialog" aria-label="Keyboard shortcuts">
        <p className="toc-title">Keyboard shortcuts</p>
        <dl className="shortcuts-list">
          {rows.map(([keys, what]) => (
            <React.Fragment key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{what}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </div>,
    document.body
  );
}
