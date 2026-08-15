/**
 * Host shim — same tree as {@link ../lib/Frame.App}, with RSC `children`
 * instead of {@link Layout.Outlet}. Product SSOT is `Frame.App` +
 * `Layout.provide`; retire this when soft-nav hosts the body layout.
 */
import type { ReactNode } from "react";
import * as Frame from "../lib/Frame";

export default function Layout(props: {
  readonly children: ReactNode;
}) {
  return <Frame.Tree>{props.children}</Frame.Tree>;
}
