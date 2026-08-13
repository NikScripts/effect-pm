/**
 * @module examples/last/router-context/lib/AppTree
 *
 * Main-group composition — zero DOM tags. Reads root scope via `Last.use(App)`.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as App from "./App";

export const AppTree = (): React.ReactElement => {
  const { NavBar, Frame } = Last.use(App.App);
  return (
    <>
      <NavBar.View />
      <Frame.View />
    </>
  );
};
