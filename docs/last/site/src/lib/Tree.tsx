/**
 * Composition only — place region Views from `Last.use(SiteKit)` (zero DOM).
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as SiteKit from "./SiteKit";

export const Tree = (props: {
  readonly children?: React.ReactNode;
}): React.ReactElement => {
  const { Site, NavBar, Sidebar, Main, Footer, LayoutGrid } = Last.use(
    SiteKit.SiteKit,
  );
  return (
    <Site.Root>
      <NavBar.View />
      <Site.Body>
        <LayoutGrid.View>
          <Sidebar.View />
          <Main.View>{props.children}</Main.View>
        </LayoutGrid.View>
      </Site.Body>
      <Footer.View />
    </Site.Root>
  );
};
