---
"hyperlink-ts": patch
---

Lookup import hygiene — no `Module.Tag.member` triples.

- Barrel + subpath: named `Advice` / `Directory` / `Identity` re-exports for
  `import { Advice } from "hyperlink-ts"` (or `…/Lookup`) → `Advice.changes`.
- Public prose and examples prefer flat Lookup verbs (`advise`, `changes`,
  `nodesServing`) or named Tags; ban nesting like `Lookup.Advice.changes`.
