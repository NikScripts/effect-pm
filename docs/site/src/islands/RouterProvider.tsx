"use client";

/** Mount {@link ../ui/Router.make}(`site`) for the book chrome. */
import * as React from "react";
import { site } from "../lib/siteRoutes.js";
import * as Router from "../ui/Router.js";

const router = Router.make(site);

export function RouterProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Router.Provider value={router}>{props.children}</Router.Provider>
  );
}
