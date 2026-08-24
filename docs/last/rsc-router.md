{#last-rsc-router title="RSC + Router" status="stable" appliesTo=last-ts}
<!-- docs-site-link:begin -->
> [!NOTE]
> last-ts docs server (`docs/last/site`) — not Hyperlink `docs/site`.
<!-- docs-site-link:end -->
# RSC + Router

How **last.ts** wires file pages + typed soft-nav + View kits.

**App:** [`docs/last/site/`](https://github.com/nikolasstow/Hyperlink/blob/integration/docs/last/site/)  
**Run:** `pnpm run docs:last-site`  
**Corrections:** [`../handoffs/last-ts-api-corrections.md`](../handoffs/last-ts-api-corrections.md)  
**Context lock:** [`../handoffs/last-context-view-lock.md`](../handoffs/last-context-view-lock.md)

## Split of jobs

| Layer | Job |
|-------|-----|
| Waku host `createPages` + `adapter` (host entry only) | RSC host registration (no Waku `fsRouter`) |
| `last-ts/vite` `fileRouter` → `paths.gen.ts` | Typed file path table |
| `Router.make` + `.context(SiteKit)` + `Route.get` | Typed catalog / kit debt |
| `Last.provideContext` + `Layout.provide` | Builder fulfill |
| `Last.provider(layer)` + `last-ts/Waku` | Soft-nav edge (no second kit arg) |
| `ui/*` View kits | Leaf HTML; Tree composition via `Last.use` |

Apps **never** `import` from `waku`.

## Layout

```text
docs/last/site/src/
  ui/           View kits (NavBar, Sidebar, Main, Footer, LayoutGrid)
  lib/
    Catalog.ts  paths + urls (Link)
    SiteKit.ts  nested Last.context
    Tree.tsx    composition only
    Frame.tsx   Layout.make → Tree
    site.ts     Site.context(SiteKit) + routes
    Provider.tsx  Last.provider(layer) only
  pages/        Page mints
```

## Catalog (paths)

{.twoslash include="docs/last/site/src/lib/Catalog.ts"}
``` ts
```

## Site + routes

{.twoslash include="docs/last/site/src/lib/site.ts"}
``` ts
```

## SiteKit

{.twoslash include="docs/last/site/src/lib/SiteKit.ts"}
``` ts
```

## NavBar (leaf HTML + composition)

{.twoslash include="docs/last/site/src/ui/NavBar.tsx"}
``` tsx
```

## Tree + Frame

{.twoslash include="docs/last/site/src/lib/Tree.tsx"}
``` tsx
```

{.twoslash include="docs/last/site/src/lib/Frame.tsx"}
``` tsx
```

## Provider

{.twoslash include="docs/last/site/src/lib/Provider.tsx"}
``` tsx
```

## Client island

`/view` — [`ViewDemo`](https://github.com/nikolasstow/Hyperlink/blob/integration/docs/last/site/src/islands/ViewDemo.tsx) uses const Layers + `Last.provide(Tag, layer)`.
