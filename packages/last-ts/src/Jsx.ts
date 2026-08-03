/**
 * @module Jsx
 *
 * Typed JSX for Last — `Element<R>` and helpers. Pair with
 * `"jsxImportSource": "last-ts"` (or a per-file `@jsxImportSource last-ts` pragma).
 *
 * **Critical:** do not collapse `JSX.Element` to a non-generic alias — that
 * re-introduces React’s erase. Expression types come from `jsx` / `jsxs`
 * return types in `last-ts/jsx-runtime`.
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
 * Widen a plain React node to {@link Element}`<never>` for mixed trees.
 *
 * @public
 */
export type AsElement<E extends React.ReactNode> = E extends Element<infer R>
  ? Element<R>
  : Element<never>;
