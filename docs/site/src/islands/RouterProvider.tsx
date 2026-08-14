"use client";

/** Waku catalog Layer via {@link Last.provider} — children-only. */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Waku";
import { site, urls } from "../lib/siteRoutes.js";

const Provider = Last.provider(Waku.fromApi(site, urls));

export function RouterProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <Provider>{props.children}</Provider>;
}
