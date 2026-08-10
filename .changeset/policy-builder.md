---
"hyperlink-ts": minor
---

`PolicyBuilder`: HttpApi-shaped constructables with Schema keys. Each key is a
PascalCase `Context.Reference` on the Def (`defaultValue` = Reference default)
plus a camelCase Layer method via `Uncapitalize(key)` (`"Sticky"` → `sticky`,
`"StreamGap"` → `streamGap`). Domain modules use a **plural** constructable
(`LookupPolicies` / `NodePolicies`; today’s `LookupPolicies`) and a
**singular** module namespace (`LookupPolicy` / `NodePolicy`). Modules re-export
refs and mode presets over those methods. No `Family`, no `Fragment.*` nest.

`make` accepts a product bag or `Fragment[]`; Def `isFragment` /
`matchFragment` / `fromConfig` / `toConfig` for the fragment data sum.
