---
"last-ts": minor
"hyperlink-ts": minor
---

**Breaking — edge fulfill:** `Last.provide` is `Effect.provide` + `runSync` only (Services are Effects: `Last.provide(Hello, Hello.layer)`). Deleted `View.mount`, `View.stamp`, `Last.app` / `toProvider` / bag `toLayer`, and deprecated `Waku.router`. Edge ViewFn: `Last.provide(Hello, Hello.layer)`; React bake: `Last.provider(layer)`.

**Rename:** `group.fromEffect` / `groupsFromEffect` → `group.effect` / `groupsEffect` (mirrors `Layer.effect`).
