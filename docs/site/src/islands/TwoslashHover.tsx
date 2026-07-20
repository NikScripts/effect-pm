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
    // the comments. Double-tap one to copy just it.
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

    const closeNow = (): void => {
      if (openEl) {
        openEl.classList.remove("is-open");
        clearPos(openEl);
        openEl = null;
      }
    };

    // Touch model: single-tap a token to open/close its sticky popup; DOUBLE-tap a preview section to
    // copy it. A plain tap-and-drag is left untouched, so normal iOS text selection still works.
    // (Long-press was dropped — it fought iOS's own long-press selection, breaking BOTH manual
    // selection and the copy; a quick tap doesn't, which is why short holds always copied fine.)
    const DOUBLE_MS = 350; // max gap between the two taps of a double-tap
    const TAP_SLOP = 12; // px; more movement than this is a drag (select/scroll), not a tap
    let downAt: { x: number; y: number } | null = null;
    let lastTapEl: Element | null = null;
    let lastTapTime = 0;
    const flashCopied = (section: Element): void => {
      section.classList.add("tw-copied");
      window.setTimeout(() => section.classList.remove("tw-copied"), 450);
    };
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) {
        downAt = null;
        return;
      }
      const t = e.touches[0];
      downAt = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e: TouchEvent): void => {
      const start = downAt;
      downAt = null;
      if (start === null) return;
      const t = e.changedTouches[0];
      // a drag (text selection or scroll) — leave it entirely to the browser
      if (
        t === undefined ||
        Math.abs(t.clientX - start.x) > TAP_SLOP ||
        Math.abs(t.clientY - start.y) > TAP_SLOP
      ) {
        lastTapEl = null;
        return;
      }
      const el = e.target as Element | null;
      const section = el?.closest?.(".twoslash-popup-code, .twoslash-popup-docs") ?? null;
      const hover = el?.closest?.(".twoslash-hover") ?? null;
      // tap outside any token/popup → close the open one
      if (section === null && hover === null) {
        lastTapEl = null;
        closeNow();
        return;
      }
      if (section !== null) {
        const now = Date.now();
        if (lastTapEl === section && now - lastTapTime < DOUBLE_MS) {
          lastTapEl = null; // second tap on the same section → copy it
          lastTapTime = 0;
          copySection(section);
          flashCopied(section);
          window.getSelection()?.removeAllRanges(); // clear the word iOS selects on a double-tap
        } else {
          lastTapEl = section;
          lastTapTime = now;
        }
        return;
      }
      // a token in the code (outside the popup): open/close its sticky popup
      lastTapEl = null;
      if (openEl === hover) closeNow();
      else if (hover !== null) open(hover);
    };

    // An open popup is `position: fixed` (see place()) — scrolling would leave it floating at its
    // old viewport spot. Re-anchor it to the token on every scroll (capture phase, so the code
    // block's own horizontal scroll counts too) and on resize; rAF-throttled.
    let placeRaf = 0;
    const reanchor = (): void => {
      if (openEl === null || placeRaf !== 0) return;
      placeRaf = requestAnimationFrame(() => {
        placeRaf = 0;
        if (openEl) place(openEl);
      });
    };
    document.addEventListener("scroll", reanchor, { passive: true, capture: true });
    window.addEventListener("resize", reanchor);

    // Hover devices open on hover; touch devices use tap-to-open + double-tap-to-copy above.
    const hoverCapable =
      typeof window !== "undefined" && window.matchMedia?.("(hover: hover)")?.matches === true;
    if (hoverCapable) {
      document.addEventListener("mouseover", onOver);
      document.addEventListener("mouseout", onOut);
    } else {
      document.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("touchend", onTouchEnd, { passive: true });
    }
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("scroll", reanchor, { capture: true });
      window.removeEventListener("resize", reanchor);
      if (placeRaf) cancelAnimationFrame(placeRaf);
      cancelClose();
      if (toastTimer) clearTimeout(toastTimer);
      toastEl?.remove();
    };
  }, []);
  return null;
}
