/**
 * Composition only — place region Views from `Last.use(SiteKit)`.
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import { SiteKit } from "./SiteKit";

export const Tree = (props: {
  readonly children?: React.ReactNode;
}): React.ReactElement => {
  const { NavBar, Sidebar, Main, Footer, LayoutGrid } = Last.use(SiteKit);
  return (
    <>
      <NavBar.View />
      <LayoutGrid.View>
        <Sidebar.View />
        <Main.View>{props.children}</Main.View>
      </LayoutGrid.View>
      <Footer.View />
    </>
  );
};
