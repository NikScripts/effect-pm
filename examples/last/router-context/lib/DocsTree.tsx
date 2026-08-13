/**
 * @module examples/last/router-context/lib/DocsTree
 *
 * Docs-group composition — zero DOM tags. Root + docs scopes via `Last.use`.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as App from "./App";

export const DocsTree = (): React.ReactElement => {
  const { NavBar, Frame } = Last.use(App.App);
  const docs = Last.use(App.App, "docs");
  return (
    <>
      <NavBar.View />
      <Frame.Root>
        <docs.Sidebar.View />
        <Frame.Main>
          <Layout.Outlet />
        </Frame.Main>
      </Frame.Root>
    </>
  );
};
