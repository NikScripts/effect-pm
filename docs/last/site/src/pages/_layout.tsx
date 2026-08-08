import type { ReactNode } from "react";
import { Nav } from "../islands/Nav";
import { Provider } from "../lib/Provider";

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
