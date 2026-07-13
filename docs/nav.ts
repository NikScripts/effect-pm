// The book's structure — the ONE place chapter grouping + order live. Page titles are
// NOT here; they're derived from each page's own block (single source of truth). To add a
// page, drop its slug into a group; anything unlisted still shows under "More" so nothing
// silently disappears. Reorder = edit these lists (no file renames, no per-page churn).

export interface NavGroup {
  readonly label: string;
  readonly slugs: ReadonlyArray<string>;
}

export const nav: ReadonlyArray<NavGroup> = [
  {
    label: "Getting started",
    slugs: ["index"],
  },
  {
    label: "Guides",
    slugs: ["resource", "queues", "run-resources", "processes"],
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
