---
"hyperlink-ts": minor
---

Lookup Tags are sibling modules — not nested under Lookup.

- New subpaths: `hyperlink-ts/Advice`, `hyperlink-ts/Directory`, `hyperlink-ts/Identity`
  (`import * as Advice` → `Advice.Tag` / `Advice.prefer` / `Advice.changes`).
- Apps must not `import { Advice } from "hyperlink-ts/Lookup"` or chain
  `Lookup.Advice.*`. Lookup keeps layers (`layer` / `client`) + sugar re-exports.
