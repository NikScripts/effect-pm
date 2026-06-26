/**
 * @module web/useViewTransition
 *
 * Animate a navigation state change with the browser's **View Transitions API** instead
 * of cutting: a crossfade by default, plus a morph between any "before" and "after"
 * elements that share a {@link viewTransitionStyle} name (e.g. a grid card and the detail
 * header it opens into). Degrades to an instant update where the API is unavailable
 * (older browsers), so behavior is unchanged there.
 *
 * ```tsx
 * const transition = useViewTransition();
 * // a grid card and the detail it opens into share a name → the card morphs into it
 * <button style={viewTransitionStyle(`res-${tag.id}`)} onClick={() => transition(() => setSelected(tag))} />
 * ```
 *
 * @since 1.0.0
 */
import * as React from "react";
import { flushSync } from "react-dom";

interface ViewTransitionDocument {
  readonly startViewTransition?: (callback: () => void) => unknown;
}

/**
 * Returns `transition(update)` — applies `update` (a React state change) inside a view
 * transition when the browser supports it, else applies it immediately. State updates are
 * flushed synchronously so the transition captures the new view.
 *
 * @since 1.0.0
 */
export const useViewTransition = (): ((update: () => void) => void) =>
  React.useCallback((update: () => void) => {
    const doc: ViewTransitionDocument =
      typeof document === "undefined" ? {} : document;
    if (typeof doc.startViewTransition === "function") {
      doc.startViewTransition(() => flushSync(update));
    } else {
      update();
    }
  }, []);

/**
 * Names an element for view transitions — give the same `name` to the element being left
 * and the one being entered (e.g. a card and the detail it opens into) and the browser
 * morphs one into the other across a {@link useViewTransition} update. A name must be
 * unique among the elements rendered at any one time.
 *
 * @since 1.0.0
 */
export const viewTransitionStyle = (name: string): React.CSSProperties => ({
  viewTransitionName: name,
});
