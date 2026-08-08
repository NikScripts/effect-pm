# Router — HttpApi lock (Page = success kind)

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng (Page success on tip)  
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
- `handle(id, …)` typed from the endpoint:
  - Page → `ComponentType<PageProps>` | JSX element | `Effect → ReactNode`
  - Json/etc. → Effect handler
- `Router.PageProps<typeof Site, "app", "chapter">` (also on `Route` /
  `RouterBuilder`) derives props from params/query schemas
- Completeness: every endpoint in the group must be handled
- Mixed groups are normal: one group can hold Page + Json endpoints; one
  `Handlers` bag implements both

### Handlers target shape (locked)

| Piece | Shape |
|-------|--------|
| Page handler | `Effect → ReactNode` (plus JSX overload `<Home />`; legacy `ComponentType<PageProps>` still accepted) |
| Nested regular components | `Page.Request` Effect service + React bridge `Page.useRequest` |
| Document title | `Page.Document` set-anywhere service + `Page.useDocument` bridge |
| Layout | component + `children` (no Outlet-as-service) |
| Baked Effect view | `View.effect(effect)` → `ComponentType` (no `<Run effect={…} />`) |
| `View.make` redesign | **Parked for later** |

```ts
class Site extends Router.make("site").add(
  Router.group("app").add(
    Route.get("chapter", "/:chapter", {
      params: { chapter: Schema.String },
    }),
    HttpApiEndpoint.get("getUser", "/users/:id", {
      params: { id: Schema.String },
      success: User,
    }),
  ),
) {}

const Chapter = Effect.gen(function* () {
  const req = yield* Page.Request
  yield* (yield* Page.Document).set(`Chapter ${req.params.chapter}`)
  return <h1>{req.params.chapter}</h1>
})

const app = RouterBuilder.group(Site, "app", AppLayout, (h) =>
  h
    .handle("chapter", Chapter)
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

1. ~~Page success + `Route.get` + builder dispatch + PageProps~~ (on tip).
2. ~~Handlers target shape (Request / Document / Effect→ReactNode /
   `View.effect` / layout=`children`)~~ — Eng on tip; **`View.make`
   redesign parked**.
3. Catalog shell thin-wrap onto Effect `HttpApi` types (follow-on).
4. Migrate remaining tip tests / file-router consumers as needed.

## Tip note

On tip:

- `Route.get` → `HttpApiEndpoint.get` with `success: Route.Page` (`text/html`)
- Catalog keeps real endpoints (no URL-only projection)
- `RouterBuilder.handle` dispatches: Page → React / JSX / Effect→ReactNode;
  other success → Effect API handler
- `Page.Request` / `Page.Document` + React bridges under `Router.Outlet`
- `View.effect(effect)` bakes Effect → `ComponentType`
- UI `match` / Outlet are Page-only; urlBuilder includes all endpoints
- Catalog shell (`Router.make` / nested groups / `from(Service)`) still last-ts;
  full thin-wrap onto Effect `HttpApi` types is follow-on
- `View.make()(key, default)` — optional Reference slots (Eng’d); no HttpApi-shaped View catalog
