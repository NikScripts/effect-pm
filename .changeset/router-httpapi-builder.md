---
"last-ts": minor
"hyperlink-ts": minor
---

HttpApi-shaped Router aligned with Effect `HttpApi` / `HttpApiBuilder`:

- `Router.make` / `Router.group` (+ `group.key`, `annotateMerge`, `annotateEndpoints*`)
- `RouterBuilder.Handlers` builder (`handle` / `handleAll` record / `handleEach`), `ValidateReturn` string literals
- `RouterBuilder.group` → `Layer.effectContext` under `group.key`; typed `Group.Service` / `ToService`
- `RouterBuilder.layer` → `Catalog` + `Registry`; missing-group die lists available keys
- `Memory` / `History` / `Waku` require `Catalog` | `Registry`
- `group.from(Service)` + `Router.layerDestinations`; flat `Group.asRoutes`
- Layouts require `children`; `{ layout: false }` opts out on `handle`
- Mix Effect HttpApi peers into the URL catalog: `Router.make(...).add(HttpApiGroup, Router.group)` and `Router.group(...).add(Route.get, HttpApiEndpoint)` (URL surface only); `.addHttpApi(api)` spreads groups
