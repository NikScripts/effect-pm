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
      {/* Override Waku's default viewport: `viewport-fit=cover` lets the page paint under
          the notch/safe-area, so html's dark background fills it instead of white. */}
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      {/* Tint the mobile browser chrome (status bar / notch) to match the page in each mode. */}
      <meta name="theme-color" content="#fafbfc" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#141619" media="(prefers-color-scheme: dark)" />
      <nav>
        <a className="brand" href="/">effect-pm</a>
      </nav>
      <div className="layout">
        <aside className="sidebar">
          <details className="chapters">
            <summary>Chapters</summary>
            {items.map((i) => (
              <a key={i.href} href={i.href}>{i.title}</a>
            ))}
          </details>
        </aside>
        <main>{children}</main>
      </div>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
