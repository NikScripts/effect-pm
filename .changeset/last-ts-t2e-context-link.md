---
"last-ts": patch
---

**T2e dogfood:** `examples/last/context-link` fulfills Site/DocsKit via
`.context` + `Last.provideContext` — no `Last.provider(layer, Site)`. Home SSR
omits the docs kit (`data-docs`).
