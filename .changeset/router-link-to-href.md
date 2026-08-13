---
"last-ts": minor
---

`Router.Link` / `Waku.Link` `to` is typesafe only: `Route.PathsOf` literals, branded `Route.Href` from `urlBuilder`, or `(urls) => urls.group.route(…)`. Bare `string` is rejected — use `out` for external / free-form URLs.
