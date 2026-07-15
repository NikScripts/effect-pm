// The book's structure — the ONE place chapter grouping + order live. Page titles are
// NOT here; they're derived from each page's own block (single source of truth). To add a
// page, drop its slug into a group; anything unlisted still shows under "More" so nothing
// silently disappears. Reorder = edit these lists (no file renames, no per-page churn).

export interface NavGroup {
  readonly label: string;
  readonly slugs: ReadonlyArray<string>;
  // A standalone page, not a group: rendered as a lone top-level link (no header, no collapse).
  // Use for a single-page entry that doesn't belong in a collapsible section.
  readonly lone?: boolean;
}

export const nav: ReadonlyArray<NavGroup> = [
  {
    label: "Getting started",
    slugs: ["index", "install", "core-concepts", "creating-a-resource", "glossary"],
  },
  {
    label: "Resources",
    slugs: ["contracts", "fleets-and-peers", "readiness", "configuration"],
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
    slugs: ["observation-and-control", "dashboard", "react-components", "tui-cli"],
  },
  {
    // A single page, not a section — a lone link that sits directly above Standards.
    label: "Examples",
    slugs: ["examples"],
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
