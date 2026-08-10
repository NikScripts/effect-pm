---
"hyperlink-ts": minor
---

`PolicyBuilder`: HttpApi-shaped constructables with Schema keys. Each key is a
PascalCase `Context.Reference` on the Def (`defaultValue` = Reference default).
Domain modules use a **plural** constructable (`LookupPolicies` / `NodePolicies`;
today’s interim `Policies`) and a **singular** module namespace
(`LookupPolicy` / `NodePolicy`). Modules re-export refs and recreate camelCase
Layer helpers (`sticky`, `streamGap`, …) plus mode presets. No `Family`, no
`Fragment.*` nest.

`make` accepts a product bag or `Fragment[]`; Def `$is` / `$match` /
`$fromConfig` / `$toConfig` for the fragment data sum.
