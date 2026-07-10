import "../styles/docs.css";
import type { ReactNode } from "react";
import { navItems } from "../lib/docs-content.js";

// Root layout — owns all chrome. Nav is generated from the content manifest,
// so adding a `.dj` file updates the nav with no edit here.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const items = await navItems();
  return (
    <>
      <meta name="description" content="Official documentation for @nikscripts/effect-pm" />
      <nav>
        <a className="brand" href="/">effect-pm</a>
        {items.map((i) => (
          <a key={i.href} href={i.href}>{i.title}</a>
        ))}
      </nav>
      <main>{children}</main>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
