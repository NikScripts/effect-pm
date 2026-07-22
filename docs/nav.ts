// The book's structure — the ONE place chapter grouping + order live. Page titles are
// NOT here; they're derived from each page's own block (single source of truth). To add a
// page, drop its slug into a group; anything unlisted still shows under "More" so nothing
// silently disappears. Reorder = edit these lists (no file renames, no per-page churn).

export interface NavGroup {
  readonly label: string;
  readonly slugs?: ReadonlyArray<string>;
  // A direct route link (e.g. "/api") instead of doc slugs — for a lone entry that isn't a doc page.
  readonly href?: string;
  // Direct route links as GROUP CHILDREN (label + href, no doc slugs) — for a collapsible group
  // over non-doc routes, e.g. the API Reference group's package links.
  readonly links?: ReadonlyArray<{
    readonly label: string;
    readonly href: string;
  }>;
  // A standalone page, not a group: rendered as a lone top-level link (no header, no collapse).
  // Use for a single-page entry that doesn't belong in a collapsible section.
  readonly lone?: boolean;
}

export const nav: ReadonlyArray<NavGroup> = [
  {
    // Glossary intentionally omitted — it's a reference utility, linked from the footer, not a chapter.
    label: "Getting started",
    slugs: ["index", "install", "core-concepts", "managing-layers"],
  },
  {
    label: "Resources",
    slugs: [
      "creating-a-resource",
      "contracts",
      "fleets-and-peers",
      "readiness",
      "configuration",
    ],
  },
  {
    label: "Guides",
    slugs: [
      "queues",
      "run-resources",
      "processes",
      "stores",
      "logs",
      "metrics",
      "telemetry",
      "fleet-health",
      "shardmap",
    ],
  },
  {
    // Tentative group name — "Observe and Control" per the outline, may change.
    label: "Observe and Control",
    slugs: [
      "observation-and-control",
      "dashboard",
      "react-components",
      "tui-cli",
    ],
  },
  {
    // A collapsible group over the API routes: our own package first, then the all-packages index.
    label: "API Reference",
    links: [
      { label: "Effect PM", href: "/api/hyperlink-ts" },
      { label: "All Packages", href: "/api" },
    ],
  },
  {
    label: "Examples",
    slugs: ["examples"],
    lone: true,
  },
  {
    label: "Releases",
    href: "/releases",
    lone: true,
  },
  {
    label: "Standards",
    slugs: [
      "principles",
      "modules-and-boundaries",
      "types-and-naming",
      "effect-style",
      "documentation",
      "error-handling",
      "resources",
      "storage",
      "no-backward-compat",
      "working-agreement",
    ],
  },
];
