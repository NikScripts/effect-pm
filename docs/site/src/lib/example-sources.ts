// Runnable teaching scripts under `examples/forms/**` for `{.twoslash include="…"}` fences.
//
// Vite `?raw` glob (same pattern as `./content.ts`) — editing an example HMR-updates the paired
// doc without `node:fs` in the render path. Offline checkers use `./example-include.ts` + disk.

import { normalizeExampleRel } from "./example-include.js";

export {
  normalizeExampleRel,
  prepareExampleForTwoslash,
  rewriteExampleImportsForDocs,
  loadExampleIncludeFromDisk,
} from "./example-include.js";

const modules = import.meta.glob(
  [
    "../../../../examples/forms/**/*.ts",
    "../../../../examples/shared/**/*.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const byRel: ReadonlyMap<string, string> = new Map(
  Object.entries(modules).map(([key, text]) => [normalizeExampleRel(key), text]),
);

/**
 * Load a teaching example for an `include=` fence. `rel` is repo-relative
 * (`examples/forms/queue/workpool-priority-retry.ts`). Undefined when missing from the glob.
 */
export const exampleSource = (rel: string): string | undefined => byRel.get(normalizeExampleRel(rel));
