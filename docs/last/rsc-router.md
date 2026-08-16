{#last-rsc-router title="RSC + Router" status="stable" appliesTo=last-ts}
<!-- docs-site-link:begin -->
> [!NOTE]
> Rendered docs (Tailscale):
> <http://100.67.32.32:5190/docs/rsc-router>
>
> Running site:
> <http://100.67.32.32:5220/>
<!-- docs-site-link:end -->
# RSC + Router

How **last.ts** wires file pages + typed soft-nav + View kits.

**App:** [`docs/last/site/`](https://github.com/nikolasstow/Hyperlink/blob/integration/docs/last/site/)  
**Run:** `pnpm run docs:last-site`  
**Corrections:** [`../handoffs/last-ts-api-corrections.md`](../handoffs/last-ts-api-corrections.md)  
**Context lock:** [`../handoffs/last-context-view-lock.md`](../handoffs/last-context-view-lock.md)

## Live render

Same View demo as the product site `/view` (`docs/last/site` island):

```last-rsc
```

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
  ui/           View kits (Site, NavBar, Sidebar, Main, Footer, LayoutGrid)
  lib/
    Catalog.ts  paths + urls (Link)
    SiteKit.ts  nested Last.context
    Tree.tsx    composition only (zero DOM)
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

## Site (viewport leaves)

{.twoslash include="docs/last/site/src/ui/Site.tsx"}
``` tsx
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

## View demo source

{.twoslash include="docs/last/site/src/islands/ViewDemo.tsx"}
``` tsx
```
