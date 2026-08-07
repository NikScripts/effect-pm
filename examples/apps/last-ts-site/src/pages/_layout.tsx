import type { ReactNode } from "react";
import * as Page from "last-ts/Page";
import { Nav } from "../islands/Nav.js";
import { RouterProvider } from "../islands/RouterProvider.js";

function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <RouterProvider>
      <div className="shell">
        <Nav />
        <main className="main">{children}</main>
      </div>
    </RouterProvider>
  );
}

const Stamped = Page.layout("/", Layout);
export default Stamped;
export const getConfig = Page.getConfig(Stamped);
