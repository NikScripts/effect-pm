# Router — HttpApi-shaped lock (Eng)

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng  
**Package:** `last-ts`

## Locks

| Effect | Ours |
|--------|------|
| `HttpApi.make` | `Router.make` |
| `HttpApiGroup.make` | `Router.group` |
| `HttpApiGroup.key` / `Service` / `ToService` | `group.key` / `Group.Service` / `Group.ToService` |
| `HttpApiEndpoint.get` | `Route.get` |
| `HttpApiBuilder.Handlers` | `RouterBuilder.Handlers` (`.handle` / `.handleAll` record / `.handleEach`) |
| `HttpApiBuilder.group` | `RouterBuilder.group(api, id, layout, build)` — layout is UI-only 3rd arg |
| `HttpApiBuilder.layer` | `RouterBuilder.layer(api)` → `Catalog` + `Registry` |
| `HttpApiClient.urlBuilder` | `RouterClient.urlBuilder` |
| Node / server Layer | `History.layer` / `Memory.layer` / `Waku.layer` |

- Catalog is **data** (`class extends Router.make` or value) — not `yield*`.
- Flat groups only (`group.add` endpoints only).
- **Mix HttpApi peers into the catalog (URL surface only):**
  - `Router.make(...).add(HttpApiGroup.make(...), Router.group(...))`
  - `Router.group(...).add(Route.get(...), HttpApiEndpoint.get(...))`
  - `Router.make(...).addHttpApi(api)` spreads each group (same as `.add(...groups)`)
- No handlers / layouts on the contract.
- `Layout` must declare `children: React.ReactNode`.
- Group layout = 3rd arg; handlers last.
- `.handle(id, Page, { layout: false })` opts out of layout.
- No stacked layouts.
- Layers **camelCase**; never `*Live`.
- External peer Layers → own namespace (`Waku`).
- `Last.provider(layer)` → children-only React provider.
- Generated routes: `group.from(Service)` on contract; provide destinations via Layer
  (`Router.layerDestinations(tag, table)` or `Layer.succeed(tag, …)`).
  `RouterBuilder.layer` resolves `from(Service)` into the provided {@link Catalog}.

## Compose

```ts
const routes = RouterBuilder.layer(Site).pipe(
  Layer.provide(Layer.mergeAll(marketing, docs)),
)
export const provider = Last.provider(
  Memory.layer.pipe(Layer.provide(routes)),
)
```

`Layer.mergeAll(routes, Memory.layer)` is wrong — Memory **requires** Catalog|Handlers that `routes` **provides**; use `Memory.layer.pipe(Layer.provide(routes))`.

### File routes (`from` + destinations Layer)

```ts
class FileRoutes extends Context.Service<
  FileRoutes,
  ReadonlyArray<Router.RoutesOf<typeof table>>
>()("app/FileRoutes") {}

class Site extends Router.make("site").add(
  Router.group("root", { topLevel: true }).from(FileRoutes),
) {}

const routes = RouterBuilder.layer(Site).pipe(
  Layer.provide(Layer.mergeAll(
    RouterBuilder.group(Site, "root", Layout, (h) =>
      h.handle("index", Home).handle("about", About),
    ),
    Router.layerDestinations(FileRoutes, table),
  )),
)
```

### Group → routes

- `Group.asRoutes(hub)` — **flat** leaf-only groups for `fromEffect` under a
  topLevel hub (`urls.Nwsl.HttpApi()` unchanged). Nested Group nodes become
  sibling route groups (full path prefix kept).

See Eng tests `test/router-builder.test.tsx`.
