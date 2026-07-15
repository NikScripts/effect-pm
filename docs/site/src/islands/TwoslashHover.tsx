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
import { WebHaptics } from "web-haptics";

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
    // --- long-press an open popup to copy its type (mobile) ---
    // A brief confirmation buzz. web-haptics uses navigator.vibrate on Android and the iOS 17.4+
    // <input switch> trick on iPhone (Safari ignores navigator.vibrate).
    const haptics = new WebHaptics();
    const haptic = (): void => {
      void haptics.trigger("success").catch(() => {});
    };

    let toastEl: HTMLDivElement | null = null;
    let toastTimer = 0;
    const toast = (msg: string): void => {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.className = "copy-toast";
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      // force reflow so the transition runs even on a rapid re-toast
      void toastEl.offsetWidth;
      toastEl.classList.add("is-visible");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl?.classList.remove("is-visible"), 1300);
    };

    const copyType = (popup: Element): void => {
      const parts = [...popup.querySelectorAll<HTMLElement>(".twoslash-popup-code")].map((c) =>
        c.innerText.trim(),
      );
      const text = parts.filter(Boolean).join("\n\n");
      if (!text) return;
      navigator.clipboard
        ?.writeText(text)
        .then(() => {
          haptic();
          toast("Copied type");
        })
        .catch(() => {});
    };

    let pressTimer = 0;
    let startAt: { x: number; y: number } | null = null;
    const cancelPress = (): void => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = 0;
      }
      startAt = null;
    };
    const onTouchStart = (e: TouchEvent): void => {
      const popup = (e.target as Element | null)?.closest?.(".twoslash-popup-container");
      if (!popup || e.touches.length !== 1) return;
      const t = e.touches[0];
      startAt = { x: t.clientX, y: t.clientY };
      pressTimer = window.setTimeout(() => {
        copyType(popup);
        cancelPress();
      }, 450);
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (startAt === null) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startAt.x) > 10 || Math.abs(t.clientY - startAt.y) > 10) cancelPress();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", cancelPress);
    document.addEventListener("touchcancel", cancelPress);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", cancelPress);
      document.removeEventListener("touchcancel", cancelPress);
      cancelClose();
      cancelPress();
      haptics.destroy();
      if (toastTimer) clearTimeout(toastTimer);
      toastEl?.remove();
    };
  }, []);
  return null;
}
