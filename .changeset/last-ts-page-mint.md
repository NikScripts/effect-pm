---
"last-ts": minor
---

`Page.make` / `Page.static` now mint pipeable pages with a default body (JSX | component | Effect); path stays file-only. Add `Route.static` to mark an existing page static (`about.pipe(Route.static)`). `RouterBuilder.handle` accepts Page mints and unwraps `.default`. Host: `Server.fromPage(path, mint)` (or `fromPage(mint)`) maps `.mode` → createPages `render` and adapts Waku flat path props into soft-nav `{ params, query, pathname, href }`.
