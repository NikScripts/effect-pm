/**
 * @module examples/last/context-link/lib/Tree
 *
 * Composition only — zero DOM tags; place region Views from `Last.use(Site)`.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Site from "./Site";

export const Tree = (): React.ReactElement => {
  const { NavBar } = Last.use(Site.Site);
  return <NavBar.View />;
};
