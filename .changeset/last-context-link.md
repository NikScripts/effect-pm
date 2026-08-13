---
"last-ts": minor
---

Add `Last.context` / `Last.use` / `Last.provider(context)` for nested View kits, `Last.link` for narrowed Link wrappers (params as props, `query` prop), and base `Link` `out` for external URLs.

`Last.use` bag typing uses Effect v4 `Context.Key` / `Context.Service.Shape` (so content services are not `unknown`).
