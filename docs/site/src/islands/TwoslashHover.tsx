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

    // Copy that works on iOS Safari over plain HTTP (Tailscale). navigator.clipboard is undefined on
    // insecure origins; iOS's execCommand copy needs a real Range selection over a RENDERED node (a
    // hidden <span>) — a textarea `.select()` is ignored. Called from touchend so it's in a gesture.
    const copyText = (text: string): boolean => {
      if (navigator.clipboard?.writeText !== undefined) {
        void navigator.clipboard.writeText(text).catch(() => {});
        return true;
      }
      try {
        const span = document.createElement("span");
        span.textContent = text;
        // rendered but visually clipped (iOS won't select an opacity:0 / hidden node), and explicitly
        // user-selectable (a `user-select: none` ancestor would otherwise block the copy).
        span.style.cssText =
          "position:fixed;top:0;left:0;white-space:pre;clip:rect(0,0,0,0);-webkit-user-select:text;user-select:text;";
        document.body.appendChild(span);
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNode(span);
        sel?.removeAllRanges();
        sel?.addRange(range);
        let ok = false;
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
        sel?.removeAllRanges();
        span.remove();
        return ok;
      } catch {
        return false;
      }
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
      const el = section as HTMLElement;
      const text = (el.innerText || el.textContent || "").trim();
      if (!text) return;
      // Always toast so the gesture has feedback either way (a failure isn't silent).
      toast(copyText(text) ? `Copied ${labelFor(section)}` : "Copy failed");
    };

    // Long-press = held ≥450ms without dragging, then released (the copy runs on touchend so it's
    // inside a gesture). Press a popup section to copy that section; press a TOKEN to open its popup
    // and copy the type — the reliable mobile path, since tap-to-open-then-press-the-popup was fragile.
    const HOLD = 400; // ms to hold before it's "armed" to copy on release
    let pressTarget: Element | null = null;
    let pressStart = 0;
    let armTimer = 0;
    let startAt: { x: number; y: number } | null = null;
    const cancelPress = (): void => {
      if (armTimer) {
        clearTimeout(armTimer);
        armTimer = 0;
      }
      pressTarget?.classList.remove("tw-pressing", "tw-armed");
      pressTarget = null;
      startAt = null;
    };
    const closeNow = (): void => {
      if (openEl) {
        openEl.classList.remove("is-open");
        clearPos(openEl);
        openEl = null;
      }
    };

    // Touch model: tap a token to open a STICKY popup (stays until you tap outside); long-press a
    // section (or the token) to copy it. A tap outside closes it.
    let outsideTap = false;
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;
      const el = e.target as Element | null;
      // the popup is a DOM descendant of its token, so `.twoslash-hover` covers both token and popup
      if (el?.closest?.(".twoslash-hover") == null) {
        outsideTap = openEl !== null; // finger landed outside any popup — close on release
        return;
      }
      outsideTap = false;
      const target = el.closest(".twoslash-popup-code, .twoslash-popup-docs, .twoslash-hover");
      if (target === null) return;
      const t = e.touches[0];
      startAt = { x: t.clientX, y: t.clientY };
      pressStart = Date.now();
      pressTarget = target;
      target.classList.add("tw-pressing"); // finger-down feedback
      armTimer = window.setTimeout(() => target.classList.add("tw-armed"), HOLD);
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (startAt === null) return;
      const t = e.touches[0];
      // generous tolerance — a long press naturally drifts a few px
      if (Math.abs(t.clientX - startAt.x) > 16 || Math.abs(t.clientY - startAt.y) > 16) cancelPress();
    };
    const onTouchEnd = (): void => {
      if (outsideTap) {
        outsideTap = false;
        closeNow();
        return;
      }
      const target = pressTarget;
      const longPress = target !== null && startAt !== null && Date.now() - pressStart >= HOLD;
      cancelPress(); // clears the press highlight
      if (target === null) return;
      if (target.matches(".twoslash-popup-code, .twoslash-popup-docs")) {
        if (longPress) copySection(target); // long-press a preview section → copy it
        return;
      }
      // a token
      if (longPress) {
        open(target); // open its popup and copy the compact type
        const code = target.querySelector(".twoslash-popup-code");
        if (code) copySection(code);
      } else if (openEl === target) {
        closeNow(); // tap an already-open token → close
      } else {
        open(target); // tap to open (sticky)
      }
    };

    // Hover devices open on hover; touch devices use the tap-open + long-press-copy model above.
    const hoverCapable =
      typeof window !== "undefined" && window.matchMedia?.("(hover: hover)")?.matches === true;
    if (hoverCapable) {
      document.addEventListener("mouseover", onOver);
      document.addEventListener("mouseout", onOut);
    } else {
      document.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("touchmove", onTouchMove, { passive: true });
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("touchcancel", cancelPress);
    }
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
