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
    // --- long-press an open popup section to copy it (mobile) ---
    // The toast IS the feedback: iOS Safari has no working web haptics (Apple patched the switch
    // trick) and no navigator.vibrate, so there's nothing reliable to buzz with.
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

    // Copy that also works over plain HTTP (Tailscale): navigator.clipboard is undefined on insecure
    // origins, so a hidden-textarea + execCommand is the primary path. Called from touchend so it runs
    // inside a real user gesture (both paths require that).
    const copyText = (text: string): boolean => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand("copy");
        ta.remove();
        if (ok) return true;
      } catch {
        // fall through to the async API
      }
      if (navigator.clipboard?.writeText !== undefined) {
        void navigator.clipboard.writeText(text).catch(() => {});
        return true;
      }
      return false;
    };

    // Each popup section is its own copyable unit: the compact type, the expanded ("pretty") type, and
    // the comments. Long-press one to copy just it.
    const labelFor = (section: Element): string =>
      section.classList.contains("twoslash-popup-expand")
        ? "expanded type"
        : section.classList.contains("twoslash-popup-docs")
          ? "comments"
          : "type";
    const copySection = (section: Element): void => {
      const text = (section as HTMLElement).innerText.trim();
      if (text && copyText(text)) {
        toast(`Copied ${labelFor(section)}`);
      }
    };

    // Long-press = held ≥450ms on one section without dragging, then released — the copy runs on
    // touchend so it's inside a gesture.
    let pressSection: Element | null = null;
    let pressStart = 0;
    let startAt: { x: number; y: number } | null = null;
    const cancelPress = (): void => {
      pressSection = null;
      startAt = null;
    };
    const onTouchStart = (e: TouchEvent): void => {
      const section = (e.target as Element | null)?.closest?.(
        ".twoslash-popup-code, .twoslash-popup-docs",
      );
      if (section === null || section === undefined || e.touches.length !== 1) return;
      const t = e.touches[0];
      startAt = { x: t.clientX, y: t.clientY };
      pressStart = Date.now();
      pressSection = section;
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (startAt === null) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startAt.x) > 10 || Math.abs(t.clientY - startAt.y) > 10) cancelPress();
    };
    const onTouchEnd = (): void => {
      if (pressSection !== null && startAt !== null && Date.now() - pressStart >= 450) {
        copySection(pressSection);
      }
      cancelPress();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", cancelPress);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", cancelPress);
      cancelClose();
      cancelPress();
      if (toastTimer) clearTimeout(toastTimer);
      toastEl?.remove();
    };
  }, []);
  return null;
}
