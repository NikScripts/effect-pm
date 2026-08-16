/**
 * Client host shim — kits + Tree for RSC `_layout` (soft-nav uses Frame.App).
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import { SiteKit } from "./SiteKit";
import * as Tree from "./Tree";

const KitProvider = Last.provider(SiteKit);

/**
 * Mount SiteKit for the host path and render region Views.
 */
export const HostLayout = (props: {
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <KitProvider>
    <Tree.Tree>{props.children}</Tree.Tree>
  </KitProvider>
);
