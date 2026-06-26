/**
 * @module web/useViewTransition
 *
 * Animate a navigation state change with the browser's **View Transitions API** instead of
 * cutting. The key idea is **conditional naming**: only the element you're navigating
 * to/from carries a `view-transition-name` during a given transition, so it morphs while
 * everything else is captured as one image and grows/fades together. (If every card were
 * always named, each would be lifted out and animate independently — the new grid's cards
 * would pop in at their final spots instead of growing with the page.)
 *
 * ```tsx
 * <ViewTransitionProvider>…app…</ViewTransitionProvider>
 *
 * const transition = useViewTransition();
 * // card: named only while it (res-<id>) is the active transition
 * <button style={useViewTransitionStyle(`res-${tag.id}`)}
 *         onClick={() => transition(`res-${tag.id}`, () => setSelected(tag))} />
 * // detail container shares the name → the card morphs into it
 * <div style={useViewTransitionStyle(`res-${tag.id}`)} />
 * ```
 *
 * Degrades to an instant update where the API is unavailable, and honors
 * `prefers-reduced-motion` via the consumer's `::view-transition-*` CSS.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { flushSync } from "react-dom";

interface ActiveName {
  readonly active: string | null;
  readonly setActive: (name: string | null) => void;
}
const ActiveNameContext = React.createContext<ActiveName>({
  active: null,
  setActive: () => {},
});

/**
 * Holds the currently-transitioning name so {@link useViewTransitionStyle} can name only
 * the active element. Wrap the part of the tree that navigates.
 *
 * @since 1.0.0
 */
export const ViewTransitionProvider = (props: {
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const [active, setActive] = React.useState<string | null>(null);
  const value = React.useMemo<ActiveName>(() => ({ active, setActive }), [active]);
  return React.createElement(ActiveNameContext.Provider, { value }, props.children);
};

interface ViewTransitionDocument {
  readonly startViewTransition?: (callback: () => void) => { readonly finished?: Promise<unknown> };
}

/**
 * Returns `transition(name, update)` — marks `name` active (so only its element is named),
 * captures the current view, applies `update` (a React state change, flushed
 * synchronously), then clears the active name when the transition finishes. Falls back to
 * an instant `update()` where the View Transitions API is unsupported.
 *
 * @since 1.0.0
 */
export const useViewTransition = (): ((name: string, update: () => void) => void) => {
  const { setActive } = React.useContext(ActiveNameContext);
  return React.useCallback(
    (name: string, update: () => void) => {
      const doc: ViewTransitionDocument = typeof document === "undefined" ? {} : document;
      if (typeof doc.startViewTransition !== "function") {
        update();
        return;
      }
      // name the source element in the *current* DOM before the snapshot is captured…
      flushSync(() => setActive(name));
      const transition = doc.startViewTransition(() => flushSync(update));
      // …then release it once the transition (target also named) completes.
      Promise.resolve(transition.finished).finally(() => setActive(null));
    },
    [setActive],
  );
};

const toIdent = (name: string): string => {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "-");
  return /^[a-zA-Z_-]/.test(cleaned) ? cleaned : `vt-${cleaned}`;
};

/**
 * Style that names an element **only while `name` is the active transition** (see
 * {@link useViewTransition}). Give the same `name` to the element being left and the one
 * being entered and the browser morphs one into the other; at all other times the element
 * is unnamed (so it's part of the page image and never animates on its own). The name is
 * sanitized to a valid CSS `<custom-ident>` (ids contain `@`/`/`, illegal in idents — an
 * invalid name is dropped and silently falls back to a crossfade).
 *
 * @since 1.0.0
 */
export const useViewTransitionStyle = (name: string): React.CSSProperties => {
  const { active } = React.useContext(ActiveNameContext);
  return active === name ? { viewTransitionName: toIdent(name) } : {};
};

/**
 * Unconditional variant of {@link useViewTransitionStyle} — always names the element. Use
 * only where exactly one element ever carries the name at a time.
 *
 * @since 1.0.0
 */
export const viewTransitionStyle = (name: string): React.CSSProperties => ({
  viewTransitionName: toIdent(name),
});
