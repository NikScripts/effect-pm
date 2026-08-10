---
"hyperlink-ts": minor
---

`PolicyBuilder`: HttpApi-shaped constructables with Schema keys. Each key is one
PascalCase **handle** — a `Context.Reference` that is also callable
`(value) => branded Policy Layer`. `defaultValue` is the Reference default
(ambient `yield* Ref`). No `Family`, no `Fragment.*` nest, no camelCase Layer
mirrors.

`Policy.Sticky(true)` / `Policy.StreamGap("stall")` / …; mode presets
(`verifyOff`, `askIncumbent`, …); `make` product bag; Def `$is` / `$match` /
`$fromConfig` / `$toConfig` for the fragment data sum.
