# Router — HttpApi lock (Page = success kind)

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** design locked — Eng pending rewrite  
**Package:** `last-ts`

## One-sentence lock

**Router is HttpApi.** A page route is an endpoint whose success encoding is
`Page` (React / HTML), not a parallel URL-only catalog. Request parts
(`params` / `query` / `headers` / `payload`) are identical to API endpoints;
only the success side differs.

Supersedes: “mix HttpApi as URL surface only” / project-endpoint-to-`Route.get`.

## Model

```
Endpoint
├── path + method
├── params / query / headers / payload   ← same for page & API
├── error / middleware                   ← same
└── success encoding
      ├── Json / Text / Form / Bytes / …  ← HttpApiSchema today
      └── Page (React component | HTML)  ← the expansion
```

`HttpApiSchema` is annotations on `effect/Schema` (status, encoding,
content-type) — not a separate type system. HTML is already expressible as
`Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/html" }))`;
we add a first-class **Page** success peer (constructor sugar + builder
dispatch), not a second router.

## Naming (still)

| Effect | Ours |
|--------|------|
| `HttpApi.make` | `Router.make` |
| `HttpApiGroup.make` | `Router.group` |
| `HttpApiGroup.key` / `Service` / `ToService` | `group.key` / `Group.Service` / `Group.ToService` |
| `HttpApiEndpoint.get` (+ options) | `Route.get` (same options; default success → Page) |
| `HttpApiBuilder.Handlers` | `RouterBuilder.Handlers` |
| `HttpApiBuilder.group` | `RouterBuilder.group(api, id, layout?, build)` — layout UI-only when present |
| `HttpApiBuilder.layer` | `RouterBuilder.layer(api)` |
| `HttpApiClient.urlBuilder` | `RouterClient.urlBuilder` |
| Node / browser transport | `History` / `Memory` / `Waku` (own namespaces) |

## Builder

Copy `HttpApiBuilder` shape:

- `Handlers.FromGroup` / `ValidateReturn` / `handle` / `handleAll` / `handleRaw`
- `handle(id, …)` typed from the endpoint: Page success → React page (or
  Effect→Page); Json/etc. → `HttpApiEndpoint.Handler`
- Completeness: every endpoint in the group must be handled
- Mixed groups are normal: one group can hold Page + Json endpoints; one
  `Handlers` bag implements both

```ts
class Site extends Router.make("site").add(
  Router.group("app").add(
    Route.get("dashboard", "/app"), // success: Page (default)
    HttpApiEndpoint.get("getUser", "/users/:id", {
      params: { id: Schema.String },
      success: User,
    }),
  ),
) {}

const app = RouterBuilder.group(Site, "app", AppLayout, (h) =>
  h
    .handle("dashboard", Dashboard)
    .handle("getUser", (req) => Effect.succeed({ id: req.params.id })),
)
```

## Request / response

- **Request:** declare on the endpoint (`params` / `query` / `headers` /
  `payload`) exactly as `HttpApiEndpoint.make` options — no parallel
  `Route.params` pipe world as SSOT (migrate to options).
- **Response:** success schema + encoding. Page is an encoding/kind;
  Json stays `HttpApiSchema.asJson` (default for ordinary schemas).
- **Client nav (Memory/History):** still “run the handler for this GET”;
  Page success mounts React (+ layout). SSR/Waku may encode Page as
  `text/html`.

## Compose (unchanged intent)

```ts
const routes = RouterBuilder.layer(Site).pipe(
  Layer.provide(Layer.mergeAll(appGroups…)),
)
export const provider = Last.provider(
  Memory.layer.pipe(Layer.provide(routes)),
)
```

- Catalog is **data** — not `yield*`.
- No handlers on the contract.
- Layers **camelCase**; never `*Live`.
- `Last.provider(layer)` → children-only React provider.
- Flat groups (endpoints only) — HttpApi groups stay flat; nested UI
  groups remain an open Eng detail if still needed for file routes.

## Eng direction (next)

1. Treat Effect `HttpApi` / `HttpApiEndpoint` / `HttpApiBuilder` /
   `HttpApiSchema` as the source to copy or thin-wrap.
2. Add `Page` success (schema/declaration + content-type / React marker).
3. `Route.get` = endpoint constructor with Page default success; accept the
   same `options` bag as `HttpApiEndpoint.get`.
4. `RouterBuilder.Handlers.handle` dispatches on success kind.
5. Retire URL-only projection (`fromHttpApiEndpoint` → erase to Route).
6. Migrate tip tests (`router-builder`, `ui-routes`) to the unified model.

## Tip note

Current tip still has the **URL-surface mix-in** (`fromHttpApiEndpoint` →
`Route.get`). That was an interim step; this lock replaces it.
