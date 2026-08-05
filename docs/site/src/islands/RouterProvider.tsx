"use client";

/** Mount Waku router binding via {@link Last.app} — children-only Provider. */
import * as React from "react";
import { Layer } from "effect";
import * as Waku from "hyperlink-ts/ui/Router/waku";
import * as Last from "last-ts/Last";
import { site } from "../lib/siteRoutes.js";
import * as Router from "../ui/Router.js";

const Provider = Last.app(Layer.empty).pipe(
  Waku.router(Router.waku(site)),
).Provider;

export function RouterProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <Provider>{props.children}</Provider>;
}
