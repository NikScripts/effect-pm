import "../styles/docs.css";
import type { ReactNode } from "react";
import { navGroups, glossaryEntries } from "../lib/docs-content.js";
import { NavBar } from "../components/NavBar.js";
import { GroupedNav } from "../components/GroupedNav.js";
import { Footer } from "../components/Footer.js";
import { TwoslashHover } from "../islands/TwoslashHover.js";
import { GlossaryHover } from "../islands/GlossaryHover.js";
import { SidebarSearch } from "../islands/SidebarSearch.js";

// Root layout — owns all chrome. Nav is generated from the content manifest,
// so adding a `.dj` file updates the nav with no edit here.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const groups = await navGroups();
  return (
    <>
      <meta name="description" content="Official documentation for @nikscripts/effect-pm" />
      {/* Override Waku's default viewport: `viewport-fit=cover` lets the page paint under
          the notch/safe-area, so html's dark background fills it instead of white. */}
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      {/* Tint the mobile browser chrome (status bar / notch) to match the page in each mode. */}
      <meta name="theme-color" content="#fafbfc" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#141619" media="(prefers-color-scheme: dark)" />
      <NavBar groups={groups} />
      <div className="layout">
        <aside className="sidebar">
          <SidebarSearch />
          <GroupedNav groups={groups} />
        </aside>
        <main>{children}</main>
      </div>
      <Footer />
      <TwoslashHover />
      <GlossaryHover data={glossaryEntries()} />
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
