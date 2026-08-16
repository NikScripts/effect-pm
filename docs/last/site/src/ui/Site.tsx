/**
 * Viewport leaf Views — outer `.site` / `.site-body` wrappers (DOM here only).
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Site/Root",
  (props) => <div className="site">{props.children}</div>,
) {}

export class Body extends View.make<Body, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Site/Body",
  (props) => <div className="site-body">{props.children}</div>,
) {}

export class SiteContext extends Last.context({
  Root,
  Body,
}) {}
