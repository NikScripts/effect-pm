/**
 * Host shim — same tree as {@link ../lib/Frame.App}, with RSC `children`
 * instead of {@link Layout.Outlet}. `Last.provider(SiteKit)` mounts kits for
 * the host path (soft-nav mounts the same kit under Outlet via `.context`).
 */
import type { ReactNode } from "react";
import * as Last from "last-ts/Last";
import { SiteKit } from "../lib/SiteKit";
import * as Tree from "../lib/Tree";

const KitProvider = Last.provider(SiteKit);

export default function Layout(props: {
  readonly children: ReactNode;
}) {
  return (
    <KitProvider>
      <Tree.Tree>{props.children}</Tree.Tree>
    </KitProvider>
  );
}
