/**
 * Development automatic JSX runtime (`react-jsxdev`).
 *
 * Same typing notes as `jsx-runtime`; delegates to `react/jsx-dev-runtime`.
 *
 * @module
 */
import type * as React from "react";
import type { JSX as ReactJSX } from "react";
import {
  Fragment as ReactFragment,
  jsxDEV as reactJsxDEV,
} from "react/jsx-dev-runtime";
import type { JSXSource } from "react/jsx-dev-runtime";
import type * as internal from "./internal/jsx";

export type Element<R = never> = internal.Element<R>;

export const Fragment = ReactFragment;

/**
 * Dev JSX create; `R` = tag services ∪ children services on the call type.
 *
 * @public
 */
export function jsxDEV<T, P>(
  type: T,
  props: P,
  key: React.Key | undefined,
  isStaticChildren: boolean,
  source?: JSXSource,
  self?: unknown,
): internal.Element<internal.ServicesOfJsx<T, P>> {
  return reactJsxDEV(
    type as React.ElementType,
    props,
    key,
    isStaticChildren,
    source,
    self,
  ) as internal.Element<internal.ServicesOfJsx<T, P>>;
}

/**
 * JSX namespace for `jsxImportSource: "last-ts"` (dev).
 *
 * @public
 */
export namespace JSX {
  export interface Element extends React.ReactElement {}
  export interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  export interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
  export type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
  export type ElementType = React.ElementType;
}
