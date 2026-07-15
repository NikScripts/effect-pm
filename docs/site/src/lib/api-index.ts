// A tiny summary of the API surface — namespace names + symbol counts — for the /api landing page,
// so it never imports the full model (which is large; Vite inlines a source map of it, ballooning
// the page in dev). Generated alongside api.json by scripts/gen-api.ts.

import summary from "../../api-index.json";

export interface ApiSummary {
  readonly entry: string;
  readonly count: number;
}

// A namespace name → URL slug: "(top-level)" reads cleaner as "top-level", and "storage/sqlite"
// can't carry a slash in a single route segment.
export const slugForEntry = (entry: string): string =>
  entry === "(top-level)" ? "top-level" : entry.replace(/\//g, "-");

export const namespaceSummaries = (): ReadonlyArray<ApiSummary> => summary.namespaces;
