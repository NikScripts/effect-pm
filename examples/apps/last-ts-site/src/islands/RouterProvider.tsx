"use client";

import * as React from "react";
import { Layer } from "effect";
import * as Last from "last-ts/Last";
import * as Waku from "last-ts/Router/waku";
import { Site } from "../lib/site.js";

const Provider = Last.app(Layer.empty).pipe(
  Waku.router(Waku.waku(Site)),
).Provider;

export function RouterProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <Provider>{props.children}</Provider>;
}
