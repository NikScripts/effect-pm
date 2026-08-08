# Page / Route — superseded note

**Superseded by:** [`last-ts-api-corrections.md`](./last-ts-api-corrections.md) +
[`router-httpapi-lock.md`](./router-httpapi-lock.md)

Agent G’s Page.asDefault / `getConfig` / `fileRootFromPages` / `fromEffect*` bake
stack in this file was **never owner-approved**. Do not Eng from the old prose
below the corrections lock.

## Still true (HttpApi)

- `Router.make` / `Route.get(id, path, options?)` — dynamic by default
- Request options bag shared with page marks
- No manual path lists / `Literal|String` unions as the product story
- Provider: `Last.provider(Waku.layer.pipe(Layer.provide(routes)))`
- `View.make` (not `View.Service`)

## Forbidden

See corrections lock — especially **any `getConfig`**.
