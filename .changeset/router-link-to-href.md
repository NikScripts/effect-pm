---
"last-ts": minor
---

`Router.link(catalog)` — derive Link in the same module as the router. Soft-nav goes through the live Router Service; `Waku.layer` only swaps the location engine. `to` is typesafe (`Route.PathsOf` / urlBuilder / callback); bare `string` rejected — use `out` for free-form URLs.
