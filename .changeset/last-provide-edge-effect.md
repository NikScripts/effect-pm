---
"last-ts": minor
"hyperlink-ts": minor
---

**Breaking — edge fulfill:** `Last.provide(Service | Effect, requirements?)` builds/runs at the page edge (Layer.effect-shaped). Deleted `View.mount`, `Last.app` / `toProvider` / bag `toLayer`, and deprecated `Waku.router`. Use `View.stamp(Last.provide(Hello))` for a JSX `Component` brand; `Last.provider(layer)` for Atom/router React bake.

**Rename:** `group.fromEffect` / `groupsFromEffect` → `group.effect` / `groupsEffect` (mirrors `Layer.effect`).
