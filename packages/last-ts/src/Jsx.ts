/**
 * @module Jsx
 *
 * Typed JSX for Last — `Element<R>` and helpers. Pair with
 * `"jsxImportSource": "last-ts"` (or a per-file `@jsxImportSource last-ts` pragma).
 *
 * Direct `jsx` / `jsxs` calls return {@link Element}`<R>`. JSX *syntax* is
 * typed by TypeScript as `JSX.Element` (black box) — use {@link ServicesOf}
 * on `jsx(...)` results or {@link View.ServicesOf} on stamped views for `R`.
 *
 * @see docs/handoffs/view-compose-draft.md
 */
import type * as React from "react";
import type * as internal from "./internal/jsx";

/**
 * React element carrying a type-level services bag `R`.
 *
 * @public
 */
export type Element<R = never> = internal.Element<R>;

/**
 * Services (`R`) on an {@link Element}.
 *
 * @public
 */
export type ServicesOf<E> = internal.ServicesOfElement<E>;

/**
 * Services contributed by a props bag’s `children` (when branded as {@link Element}).
 *
 * @public
 */
export type ServicesOfPropsChildren<P> = internal.ServicesOfPropsChildren<P>;

/**
 * Widen a plain React node to {@link Element}`<never>` for mixed trees.
 *
 * @public
 */
export type AsElement<E extends React.ReactNode> = E extends Element<infer R>
  ? Element<R>
  : Element<never>;
