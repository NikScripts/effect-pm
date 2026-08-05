/**
 * @module Layout
 *
 * React layout components for {@link ./RouterBuilder.group}. Every layout must
 * accept {@link LayoutProps.children}.
 *
 * @public
 */
import type * as React from "react";

/**
 * Props required of every router layout.
 *
 * @public
 */
export type LayoutProps = {
  readonly children: React.ReactNode;
};

/**
 * Layout component — `children` is mandatory (type error if omitted).
 *
 * @public
 */
export type Layout = React.ComponentType<LayoutProps>;
