/**
 * Automatic JSX runtime (`react-jsx`) — types merge child/tag `R` into
 * {@link Element}`<R>`; runtime delegates to `react/jsx-runtime`.
 *
 * **Do not** export `namespace JSX { type Element = … }` — a non-generic
 * `JSX.Element` collapses `R` and restores erasure. Leave `JSX.Element`
 * undefined so TypeScript uses these `jsx` / `jsxs` return types.
 *
 * @module
 */
import type * as React from "react";
import type { JSX as ReactJSX } from "react";
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs,
} from "react/jsx-runtime";
import type * as internal from "./internal/jsx";

export type Element<R = never> = internal.Element<R>;

export const Fragment = ReactFragment;

/**
 * Create an element; `R` = tag services ∪ children services.
 *
 * @public
 */
export function jsx<T, P>(
  type: T,
  props: P,
  key?: React.Key,
): internal.Element<internal.ServicesOfJsx<T, P>> {
  return reactJsx(type as React.ElementType, props, key) as internal.Element<
    internal.ServicesOfJsx<T, P>
  >;
}

/**
 * Create an element with static children; same `R` merge as {@link jsx}.
 *
 * @public
 */
export function jsxs<T, P>(
  type: T,
  props: P,
  key?: React.Key,
): internal.Element<internal.ServicesOfJsx<T, P>> {
  return reactJsxs(type as React.ElementType, props, key) as internal.Element<
    internal.ServicesOfJsx<T, P>
  >;
}

/**
 * JSX namespace for `jsxImportSource: "last-ts"`.
 *
 * Host props from React; **no** `Element` alias (preserves `R`).
 *
 * @public
 */
export namespace JSX {
  export type IntrinsicElements = ReactJSX.IntrinsicElements;
  export type IntrinsicAttributes = ReactJSX.IntrinsicAttributes;
  export type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
  /**
   * Valid tags — permissive so Radix / shadcn / plain React components work.
   * Return-type `R` still flows from our `jsx` / `jsxs` signatures.
   */
  export type ElementType = React.ElementType;
}
