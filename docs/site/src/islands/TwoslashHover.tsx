"use client";

// Twoslash hover popups live inside `pre.twoslash`, a horizontal-scroll container (`overflow-x: auto`)
// that clips its content — cutting the popup off. Pure CSS can't let a child escape a scroll container
// (Safari has no anchor positioning). So we reposition the popup to `position: fixed` on open, computed
// from the hovered token's rect, so it escapes the clip.
//
// Visibility is JS-managed (a `.is-open` class) with a small CLOSE delay, so the pointer can cross the
// EXTERNAL gap between the token and the popup without it vanishing (a pure `:hover` rule drops the
// instant you leave the token). Mounted once in the root layout; event delegation covers every block.

import * as React from "react";

const GAP = 8; // px of external space between the token and the popup
const CLOSE_DELAY = 180; // ms grace to travel from token to popup before it closes

const popupOf = (hover: Element): HTMLElement | null =>
  hover.querySelector<HTMLElement>(":scope > .twoslash-popup-container");

const place = (hover: Element): void => {
  const popup = popupOf(hover);
  if (!popup) return;
  const r = hover.getBoundingClientRect();
  // Break out of the scroll container: fixed = viewport-relative, clipped by nothing.
  popup.style.position = "fixed";
  popup.style.margin = "0";
  popup.style.bottom = "auto";
  popup.style.zIndex = "60"; // above the sticky top bar (z-index 50)
  // reading offset* forces the reflow that applies `.is-open`'s `display: block` first
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  popup.style.left = `${Math.min(Math.max(6, r.left), window.innerWidth - w - 6)}px`;
  // above the token when it fits, otherwise below
  popup.style.top = r.top - h - GAP >= 0 ? `${r.top - h - GAP}px` : `${r.bottom + GAP}px`;
};

const clearPos = (hover: Element): void => {
  const popup = popupOf(hover);
  if (!popup) return;
  for (const p of ["position", "margin", "bottom", "zIndex", "left", "top"] as const) {
    popup.style[p] = "";
  }
};

export function TwoslashHover(): null {
  React.useEffect(() => {
    let openEl: Element | null = null;
    let closeTimer = 0;

    const cancelClose = (): void => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = 0;
      }
    };
    const open = (hover: Element): void => {
      cancelClose();
      if (openEl && openEl !== hover) {
        openEl.classList.remove("is-open");
        clearPos(openEl);
      }
      openEl = hover;
      hover.classList.add("is-open");
      place(hover);
    };
    const scheduleClose = (): void => {
      cancelClose();
      closeTimer = window.setTimeout(() => {
        if (openEl) {
          openEl.classList.remove("is-open");
          clearPos(openEl);
          openEl = null;
        }
        closeTimer = 0;
      }, CLOSE_DELAY);
    };

    const onOver = (e: MouseEvent): void => {
      const hover = (e.target as Element | null)?.closest?.(".twoslash-hover");
      if (hover) open(hover);
    };
    const onOut = (e: MouseEvent): void => {
      const hover = (e.target as Element | null)?.closest?.(".twoslash-hover");
      // moving within the same hover (token <-> its popup) keeps it open
      if (hover && hover.contains(e.relatedTarget as Node | null)) return;
      if (hover) scheduleClose();
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      cancelClose();
    };
  }, []);
  return null;
}
