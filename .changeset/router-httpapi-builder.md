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
- Mix Effect HttpApi peers into the catalog; `.addHttpApi(api)` spreads groups
- `Route.Page` success (`text/html`); `Route.get` is `HttpApiEndpoint.get` + Page default
- `RouterBuilder.handle` dispatches Page → React / JSX / Effect→ReactNode; other success → Effect handler
- `Router.PageProps<Api, GroupId, EndpointId>` — schema-true page props; handle requires them
- `Page.Request` / `Page.Document` Effect services + `useRequest` / `useDocument` bridges under `Router.Outlet`
- `View.effect(effect)` bakes Effect → prop-less `ComponentType` (bridges Request/Document when present)
- Layout = component + `children`; UI match/Outlet are Page-only; urlBuilder includes all endpoints
