"use client";

/** Mount vision {@link ../ui/Router} (Waku-backed) for the book chrome. */
import * as React from "react";
import * as Router from "../ui/Router.js";

export function RouterProvider(props: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Router.Provider value={Router.docs}>{props.children}</Router.Provider>
  );
}
