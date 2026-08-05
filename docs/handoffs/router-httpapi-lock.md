# Router — HttpApi-shaped lock (Eng)

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng  
**Package:** `last-ts`

## Locks

| Effect | Ours |
|--------|------|
| `HttpApi.make` | `Router.make` |
| `HttpApiGroup.make` | `Router.group` |
| `HttpApiEndpoint.get` | `Route.get` |
| `HttpApiBuilder.group` | `RouterBuilder.group(api, id, layout, handlers)` |
| `HttpApiBuilder.layer` | `RouterBuilder.layer(api)` |
| `HttpApiClient.urlBuilder` | `RouterClient.urlBuilder` |
| Node / server Layer | `History.layer` / `Memory.layer` / `Waku.layer` |

- Catalog is **data** (`class extends Router.make` or value) — not `yield*`.
- Flat groups only (`group.add` endpoints only).
- No handlers / layouts on the contract.
- `Layout` must declare `children: React.ReactNode`.
- Group layout = 3rd arg; handlers last.
- `.handle(id, Page, { layout: false })` opts out of layout.
- No stacked layouts.
- Layers **camelCase**; never `*Live`.
- External peer Layers → own namespace (`Waku`).
- `Last.provider(layer)` → children-only React provider.
- Generated routes: `group.from(Service)` on contract; provide destinations via Layer.

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

See Eng tests `test/router-builder.test.tsx`.
