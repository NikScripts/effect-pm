# last.ts docs server

Waku RSC surface for **last-ts** (`pnpm run docs:last-site` → `:5220`).

Not Hyperlink `docs/site`.

| Piece | Shape |
|-------|--------|
| Pages | Plain Waku default exports (no `getConfig` / `Page.asDefault`) |
| Catalog | `Router.make` + `Route.get` + `urls` |
| Soft-nav | `Last.provider(Waku.layer…)` |
| View DI | `View.make` + `View.mount` |

**Locks:** [`../../handoffs/last-ts-api-corrections.md`](../../handoffs/last-ts-api-corrections.md) ·
[`../../handoffs/router-httpapi-lock.md`](../../handoffs/router-httpapi-lock.md)
