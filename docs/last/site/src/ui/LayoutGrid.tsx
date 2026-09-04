/**
 * Page grid leaf — `.layout` wrapper only.
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/LayoutGrid/Root",
  (props) => <div className="layout">{props.children}</div>,
) {}

export class LayoutGrid extends View.make<LayoutGrid, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/LayoutGrid",
  (props) => {
    const { Root: Grid } = Last.use(LayoutGridContext);
    return <Grid>{props.children}</Grid>;
  },
) {}

export class LayoutGridContext extends Last.context({
  Root,
  View: LayoutGrid,
}) {}
