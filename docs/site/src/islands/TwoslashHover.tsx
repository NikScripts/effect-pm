"use client";

// Twoslash hover popups live inside `pre.twoslash`, which is a horizontal scroll container
// (`overflow-x: auto`) and therefore clips its content — cutting the popup off at the top. Pure CSS
// can't let a child escape a scroll container (Safari lacks anchor positioning). So — exactly like
// Effect's docs (Expressive Code + Floating UI) — we reposition the popup to `position: fixed` on
// hover, computed from the hovered token's rect, so it escapes the clip. Visibility stays CSS-driven
// (`.twoslash-hover:hover > .twoslash-popup-container { display: block }`); this only positions it.
//
// Mounted once in the root layout; uses event delegation so it covers every block on the page.

import * as React from "react";

const GAP = 8; // px between token and popup

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
  // reading offset* forces the reflow that applies :hover's `display: block` first
  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  popup.style.left = `${Math.min(Math.max(6, r.left), window.innerWidth - w - 6)}px`;
  // above the token when it fits, otherwise below
  popup.style.top = r.top - h - GAP >= 0 ? `${r.top - h - GAP}px` : `${r.bottom + GAP}px`;
};

const clear = (hover: Element): void => {
  const popup = popupOf(hover);
  if (!popup) return;
  for (const p of ["position", "margin", "bottom", "zIndex", "left", "top"] as const) {
    popup.style[p] = "";
  }
};

export function TwoslashHover(): null {
  React.useEffect(() => {
    const onOver = (e: MouseEvent): void => {
      const hover = (e.target as Element | null)?.closest?.(".twoslash-hover");
      if (hover) place(hover);
    };
    const onOut = (e: MouseEvent): void => {
      const hover = (e.target as Element | null)?.closest?.(".twoslash-hover");
      // keep the popup while the pointer moves within the token or into the popup itself
      if (hover && !hover.contains(e.relatedTarget as Node | null)) clear(hover);
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);
  return null;
}
