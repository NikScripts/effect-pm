/**
 * Host shim — same tree as {@link ../lib/Frame.App}, with RSC `children`
 * instead of {@link Layout.Outlet}. Soft-nav mounts SiteKit under Outlet via
 * `.context`; this path uses {@link ../lib/HostLayout} (client).
 */
import type { ReactNode } from "react";
import { HostLayout } from "../lib/HostLayout";

export default function Layout(props: {
  readonly children: ReactNode;
}) {
  return <HostLayout>{props.children}</HostLayout>;
}
