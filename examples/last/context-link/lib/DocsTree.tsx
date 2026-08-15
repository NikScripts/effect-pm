/**
 * @module examples/last/context-link/lib/DocsTree
 *
 * Docs-group composition — root + docs scopes via `Last.use`.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as App from "./App";

export const DocsTree = (): React.ReactElement => {
  const { NavBar } = Last.use(App.App);
  const docs = Last.use(App.App, "docs");
  return (
    <>
      <NavBar.View />
      <docs.Sidebar.View />
      <Layout.Outlet />
    </>
  );
};
