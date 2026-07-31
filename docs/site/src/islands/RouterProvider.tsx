"use client";

/** Mount {@link ../ui/Router.waku}(`site`) for the book chrome (Waku layer). */
import * as React from "react";
import { site } from "../lib/siteRoutes.js";
import * as Router from "../ui/Router.js";

const router = Router.waku(site);

export function RouterProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Router.Provider value={router}>{props.children}</Router.Provider>
  );
}
