import type { ReactNode } from "react";
import { Nav } from "../islands/Nav.js";
import { provider as Provider } from "../islands/provider.js";

export default function Layout(props: {
  readonly children: ReactNode;
}) {
  return (
    <Provider>
      <div className="shell">
        <Nav />
        <main className="main">{props.children}</main>
      </div>
    </Provider>
  );
}
