/**
 * Temporary body shell — not product `Layout.make` (host-engine leftover).
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
