// Runnable teaching scripts for `{.twoslash include="examples/…"}` fences.
//
// Vite `?raw` glob — editing an example HMR-updates the paired doc. Offline checkers
// use `./example-include.ts` + disk.

import { normalizeExampleRel } from "./example-include.js";

export {
  normalizeExampleRel,
  prepareExampleForTwoslash,
  rewriteExampleImportsForDocs,
  loadExampleIncludeFromDisk,
} from "./example-include.js";

const modules = import.meta.glob(
  [
    "../../../../examples/work-pool/**/*.ts",
    "../../../../examples/gate/**/*.ts",
    "../../../../examples/daemon/**/*.ts",
    "../../../../examples/node/**/*.ts",
    "../../../../examples/fleet/**/*.ts",
    "../../../../examples/launcher/**/*.ts",
    "../../../../examples/readiness/**/*.ts",
    "../../../../examples/hyperlink/**/*.ts",
    "../../../../examples/logs/**/*.ts",
    "../../../../examples/store/**/*.ts",
    "../../../../examples/schedule/**/*.ts",
    "../../../../examples/polling/**/*.ts",
    "../../../../examples/config/**/*.ts",
    "../../../../examples/observe/**/*.ts",
    "../../../../examples/ui/**/*.ts",
    "../../../../examples/ui/**/*.tsx",
    "../../../../examples/apps/**/*.ts",
    "../../../../examples/apps/**/*.tsx",
    "../../../../examples/scenarios/**/*.ts",
    "../../../../examples/shared/**/*.ts",
  ],

  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const byRel: ReadonlyMap<string, string> = new Map(
  Object.entries(modules).map(([key, text]) => [normalizeExampleRel(key), text]),
);

export const exampleSource = (rel: string): string | undefined =>
  byRel.get(normalizeExampleRel(rel));
