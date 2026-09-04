/**
 * Wraps a client-side navigation in the View Transitions API so the browser
 * cross-fades/morphs old → new DOM instead of an instant swap. `flushSync` is
 * required here — the API snapshots the DOM synchronously around the callback,
 * and React's default batching would otherwise let it capture a stale frame.
 * Falls back to a plain call on browsers without support (Firefox, older Safari).
 *
 * @internal
 */
import { flushSync } from "react-dom";

export const navigateWithTransition = (run: () => void): void => {
  if (typeof document.startViewTransition !== "function") {
    run();
    return;
  }
  document.startViewTransition(() => flushSync(run));
};
