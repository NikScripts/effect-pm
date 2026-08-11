/**
 * Host body shell (createLayout). Soft-nav Provider lives on `_root`.
 */
import type { ReactNode } from "react";
import { Nav } from "../islands/Nav";

export default function Layout(props: { readonly children: ReactNode }) {
  return (
    <div className="shell">
      <Nav />
      <main className="main">{props.children}</main>
    </div>
  );
}
