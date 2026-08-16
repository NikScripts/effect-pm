/**
 * Main column kit — page body region.
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Main/Root",
  (props) => <main className="main">{props.children}</main>,
) {}

export class Main extends View.make<Main, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Main",
  (props) => {
    const { Root: MainRoot } = Last.use(MainContext);
    return <MainRoot>{props.children}</MainRoot>;
  },
) {}

export class MainContext extends Last.context({
  Root,
  View: Main,
}) {}
