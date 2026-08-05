---
"last-ts": minor
"hyperlink-ts": minor
---

HttpApi-shaped Router: `Router.make` / `Router.group` catalog, `RouterBuilder.group(api, id, layout, handlers)` + `RouterBuilder.layer`, `Memory.layer` / `History.layer` / `Waku`, `RouterClient.urlBuilder`, `Last.provider`. Layouts require `children`; `{ layout: false }` opts out on `handle`.

`group.from(Service)` on the contract; `RouterBuilder.layer` resolves destinations from Context (`Router.layerDestinations` / `Router.destinationsOf`). `Group.asRoutes` emits flat leaf-only groups under a topLevel hub.
