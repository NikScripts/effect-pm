/**
 * Sets `--screen-height` on the root element from `window.screen.height` —
 * the device's actual physical screen height, in CSS pixels. Confirmed
 * hands-on (DebugSafeArea.tsx readouts): unlike `100dvh`/`innerHeight`/
 * `clientHeight`, this stayed identical across the "correct" and
 * "consistently wrong" states of the standalone-mode full-height bug —
 * it's a fixed hardware property, not a viewport measurement any browser
 * state can get wrong. styles.css's standalone-mode override uses this
 * instead of `100%`/`100dvh` for exactly that reason.
 *
 * Re-read on resize/orientationchange since `screen.height`/`width` swap
 * with device rotation.
 *
 * @internal
 */
const apply = (): void => {
  document.documentElement.style.setProperty("--screen-height", `${window.screen.height}px`);
};

export const installScreenHeightVar = (): void => {
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
};
