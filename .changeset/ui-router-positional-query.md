---
"hyperlink-ts": minor
---

**UI Router dream call shape:** `Route.urlBuilder` path params are positional (`urls.node("x")`, not `{ params }`); optional trailing `{ query }` builds `?x=y`. `Router` exposes `search` / `href`; `Route.handle` receives `query` + `href`. Breaking for prior `{ params }` UrlBuilder call sites.
