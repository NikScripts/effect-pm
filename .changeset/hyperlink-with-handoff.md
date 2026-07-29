---
"hyperlink-ts": minor
---

Opt-in per-HyperService cutover: `Hyperlink.withHandoff("drainOnly" | "workPoolRelease")` runs during `Node.shutdown` after drain and before Lookup leave (default off). Strategy strings are camelCase (Effect / `OnConflict` style).
