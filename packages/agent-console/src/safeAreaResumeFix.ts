/**
 * Works around a known iOS WebKit bug: in a standalone (home-screen) PWA,
 * `env(safe-area-inset-*)` is computed correctly on first load, but gets
 * stuck at a stale value after the app is backgrounded and resumed —
 * confirmed hands-on: correct only right after "Add to Home Screen",
 * wrong after switching away and back, and staying wrong from then on
 * (not per-view — the whole session) until re-adding to the home screen.
 * CSS alone can't force WebKit to recompute it; nothing about *this* app's
 * layout is wrong.
 *
 * The standard workaround: force a reflow when the page becomes visible
 * again. Briefly detaching `<body>` from layout (`display: none`) and
 * reading `offsetHeight` before reattaching it forces WebKit to recompute
 * layout — including `env()` — against the current viewport. The flash is
 * synchronous, within one JS tick before the next paint, so it isn't
 * visible.
 *
 * @internal
 */
export const installSafeAreaResumeFix = (): void => {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    document.body.style.display = "none";
    void document.body.offsetHeight;
    document.body.style.display = "";
  });
};
