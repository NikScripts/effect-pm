/**
 * Automatic JSX runtime (`react-jsx`) — types merge child/tag `R` into
 * {@link Element}`<R>` on direct `jsx` / `jsxs` calls; runtime delegates to
 * `react/jsx-runtime`.
 *
 * **TypeScript note:** JSX *syntax* (`<Foo />`) is typed as {@link JSX.Element}
 * (or `any` if that alias is missing) — the checker does **not** use these
 * `jsx` / `jsxs` return types for expression types. Keep a non-generic
 * `JSX.Element` so host tags are not `any`. Per-call `R` still lives on
 * `jsx(...)` return types and on {@link View} stamps (`View.ServicesOf`).
 *
 * `IntrinsicElements` must be an **interface** (not a type alias).
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
 * Host props from React. `Element` is the black-box syntax result type (see
 * module doc). Prefer {@link Element}`<R>` / {@link View.ServicesOf} for `R`.
 *
 * @public
 */
export namespace JSX {
  export interface Element extends React.ReactElement {}
  export interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  export interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
  export type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
  /**
   * Valid tags — permissive so Radix / shadcn / plain React components work.
   */
  export type ElementType = React.ElementType;
}
