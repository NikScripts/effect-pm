---
"last-ts": minor
---

`Page.make` / `Page.static` now mint pipeable pages with a default body (JSX | component | Effect); path stays file-only. Add `Route.static` to mark an existing page static (`about.pipe(Route.static)`). `RouterBuilder.handle` accepts Page mints and unwraps `.default`.
