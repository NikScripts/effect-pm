import "../../styles/docs.css";
import type { ReactNode } from "react";
import { navGroups, glossaryEntries } from "../../lib/docs-content.js";
import { NavBar } from "../../components/NavBar.js";
import { ContextualNav } from "../../islands/ContextualNav.js";
import { Footer } from "../../components/Footer.js";
import { TwoslashHover } from "../../islands/TwoslashHover.js";
import { GlossaryHover } from "../../islands/GlossaryHover.js";
import { CodeCopy } from "../../islands/CodeCopy.js";
import { ShortcutsHelp } from "../../islands/ShortcutsHelp.js";
import { HoverGenProgress } from "../../islands/HoverGenProgress.js";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as nodePath from "node:path";
import { runServer } from "../../lib/runtime.js";

const readVersion = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(nodePath.join(process.cwd(), "../..", "package.json"));
  const m = /"version":\s*"([^"]+)"/.exec(text);
  return m?.[1] ?? "";
}).pipe(Effect.orElseSucceed(() => ""));

// Book chrome — docs / API / search / releases only. Coming-soon `/` is outside this group.
export default async function BookLayout({ children }: { children: ReactNode }) {
  const groups = await navGroups();
  const version = await runServer(readVersion);
  // Standards is its own book: the desktop sidebar swaps to its chapters while you're inside
  // (ContextualNav), and the regular sidebar carries a single entry link instead of the group.
  const standardsGroup = groups.find((g) => g.label === "Standards");
  const mainGroups = groups
    .filter((g) => g.label !== "Standards")
    .concat(
      standardsGroup !== undefined && standardsGroup.items[0] !== undefined
        ? [
            {
              label: "Standards",
              items: [
                {
                  slug: "",
                  href: standardsGroup.items[0].href,
                  title: "Standards",
                },
              ],
              lone: true,
            },
          ]
        : []
    );
  const standardsGroups =
    standardsGroup !== undefined
      ? [
          {
            label: "Docs",
            items: [
              {
                slug: "",
                href: "/docs/index",
                title: "← All docs",
              },
            ],
            lone: true,
          },
          standardsGroup,
        ]
      : groups;
  const standardsHrefs = standardsGroup?.items.map((i) => i.href) ?? [];
  return (
    <>
      {/* description/og tags are PER-PAGE (PageMeta) — a layout-level description here would
          duplicate them (React 19 hoists but does not dedupe meta by name) */}
      {/* Same React key as Waku's DEFAULT_HTML_HEAD viewport — replaces the bare
          `initial-scale=1` tag. `viewport-fit=cover` + html background fills notch chrome. */}
      <meta
        key="viewport"
        name="viewport"
        content="width=device-width, initial-scale=1, viewport-fit=cover"
      />
      {/* Tint the mobile browser chrome (status bar / notch) to match the page in each mode. */}
      <meta name="theme-color" content="#fafbfc" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#141619" media="(prefers-color-scheme: dark)" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <NavBar groups={groups} version={version} />
      <div className="layout">
        <aside className="sidebar">
          <ContextualNav
            main={mainGroups}
            standards={standardsGroups}
            standardsHrefs={standardsHrefs}
          />
        </aside>
        <main>{children}</main>
      </div>
      <Footer />
      <TwoslashHover />
      <GlossaryHover data={glossaryEntries()} />
      <CodeCopy />
      <ShortcutsHelp />
      <HoverGenProgress />
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
