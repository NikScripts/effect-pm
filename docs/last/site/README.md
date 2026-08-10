# last.ts docs server

Waku RSC surface for **last-ts** (`pnpm run docs:last-site` → `:5220`).

Not Hyperlink `docs/site`.

| Piece | Shape |
|-------|--------|
| Pages | `Page.make` / `Page.static` (path from file; mode on mint) |
| Host | `Server.fromPage(Mint)` → `createPage({ path, render, component })` |
| Catalog | `Router.make` + `Route.get` + `handle(id, Mint)` |
| Soft-nav | `Last.provider` + `Document.provide` + `last-ts/Waku` |
| View DI | `View.make` + `View.mount` |

**Locks:** [`../../handoffs/page-mint-lock.md`](../../handoffs/page-mint-lock.md) ·
[`../../handoffs/page-document-lock.md`](../../handoffs/page-document-lock.md) ·
[`../../handoffs/page-layout-lock.md`](../../handoffs/page-layout-lock.md) ·
[`../../handoffs/last-ts-api-corrections.md`](../../handoffs/last-ts-api-corrections.md)
