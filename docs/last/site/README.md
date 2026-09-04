# last.ts docs server

Waku RSC surface for **last-ts** (`pnpm run docs:last-site` → `:5220`).

Not Hyperlink `docs/site` — **same layout structure**, own style.

| Piece | Shape |
|-------|--------|
| Frame | `Layout.make` (`Frame.App`) — body places `Tree` only (no HTML) |
| Region UI | `ui/*` View kits — **leaf HTML via `View.make` defaults**; composition zero DOM |
| Catalog | `Router.make` + `.context(SiteKit)` + `Last.provideContext` + `Layout.provide(Frame.App)` |
| Soft-nav | `Last.provider(layer)` + `Document.provide` + `last-ts/Waku` |
| Host `_layout` | Thin RSC shim → client `HostLayout` (`Last.provider(SiteKit)` + `Tree`) |

HTML / DOM changes → touch the owning `ui/*` leaf Views (and Layer Effects that return JSX). Prefer more Layer-shaped markup over time (`Layout.make` / Document / RootLayout).

**Docs Twoslash + island:** [`../rsc-router.md`](../rsc-router.md) → `/docs/rsc-router` (includes real `docs/last/site` sources).

**Locks:** [`../../handoffs/page-mint-lock.md`](../../handoffs/page-mint-lock.md) ·
[`../../handoffs/page-document-lock.md`](../../handoffs/page-document-lock.md) ·
[`../../handoffs/page-layout-lock.md`](../../handoffs/page-layout-lock.md) ·
[`../../handoffs/last-ts-api-corrections.md`](../../handoffs/last-ts-api-corrections.md)
