---
"last-ts": minor
"hyperlink-ts": minor
---

**Breaking — edge fulfill:** `Last.provide` is `Effect.provide` + `runSync` only (Services are Effects: `Last.provide(Hello, Hello.layer)`). Deleted `View.mount`, `Last.app` / `toProvider` / bag `toLayer`, and deprecated `Waku.router`. Use `View.stamp(Last.provide(Hello, Hello.layer))` for a JSX `Component` brand; `Last.provider(layer)` for Atom/router React bake.

**Rename:** `group.fromEffect` / `groupsFromEffect` → `group.effect` / `groupsEffect` (mirrors `Layer.effect`).
