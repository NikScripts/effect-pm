# last.ts docs server

Waku RSC surface for **last-ts** (`pnpm run docs:last-site` → `:5220`).

Not Hyperlink `docs/site` — **same layout structure**, own style.

| Piece | Shape |
|-------|--------|
| Frame | `Layout.make` (`Frame.App`) · `Frame.Tree` · `Frame.Root` |
| Region UI | `NavBar` · `Sidebar` (rail) · `Main` · `Footer` — **HTML lives in these modules** |
| Catalog | `Router.make` + `Route.get` + `Layout.provide(Frame.App)` |
| Soft-nav | `Last.provider` + `Document.provide` + `last-ts/Waku` |
| Host `_layout` | Thin shim: `<Frame.Tree>{children}</Frame.Tree>` until soft-nav hosts `Frame.App` |

HTML / DOM changes → touch the owning `ui/*` or `Frame` surface (and Layer Effects that return JSX). Prefer more Layer-shaped markup over time (`Layout.make` / Document / RootLayout).

**Next:** manual main group · docs `fileSystem` · API `fromEffect`.

**Locks:** [`../../handoffs/page-mint-lock.md`](../../handoffs/page-mint-lock.md) ·
[`../../handoffs/page-document-lock.md`](../../handoffs/page-document-lock.md) ·
[`../../handoffs/page-layout-lock.md`](../../handoffs/page-layout-lock.md) ·
[`../../handoffs/last-ts-api-corrections.md`](../../handoffs/last-ts-api-corrections.md)
