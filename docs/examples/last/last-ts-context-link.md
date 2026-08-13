{#last-ts-context-link title="last-ts — context / link" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> Rendered docs (Tailscale):
> <http://100.67.32.32:5192/docs/last-ts-context-link>
<!-- docs-site-link:end -->
# last-ts — Last.context / Last.link

{.draft}
**Draft** — Twoslash fences include the **full** runnable files under `examples/last/context-link/` (no `---cut---`); each fence shows its path.

**App:** [`examples/last/context-link/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/context-link/)  
**Run:** `pnpm run example:last-context-link`  
**Lock:** [`last-context-view-lock.md`](../../handoffs/last-context-view-lock.md)

## Layout

```text
examples/last/context-link/
  ui/
    NavBar.tsx           leaves + Last.link + composition + NavBarContext
  lib/
    Catalog.ts           Router catalog (main / docs groups)
    SiteCopy.ts          Context.Service content bag
    Site.ts              nested Last.context
    Tree.tsx             composition only (Last.use → Views)
    routes.tsx           RouterBuilder handlers
    Provider.tsx         Last.provider(layer, Site)
  App.tsx                Provider > Tree
  main.ts                renderToString harness
```

## Value

- **Views** for every component slot (leaf DOM + composition)
- **`Last.context`** groups a region (`NavBarContext`) and nests under `Site`
- **`Last.use`** in composition / `Tree` (no DOM in those layers)
- **`Last.link`**: direct home brand, group-narrowed `DocsLink`, uncalled
  `ChapterLink` (`slug` + `query` props), external `out`

## Catalog

{.twoslash include="examples/last/context-link/lib/Catalog.ts"}
``` ts
```

## SiteCopy

{.twoslash include="examples/last/context-link/lib/SiteCopy.ts"}
``` ts
```

## NavBar

Leaf Views, `Last.link` wrappers, composition View, `NavBarContext`.

{.twoslash include="examples/last/context-link/ui/NavBar.tsx"}
``` tsx
```

## Site

{.twoslash include="examples/last/context-link/lib/Site.ts"}
``` ts
```

## Tree

{.twoslash include="examples/last/context-link/lib/Tree.tsx"}
``` tsx
```

## Provider

{.twoslash include="examples/last/context-link/lib/Provider.tsx"}
``` tsx
```

## App

{.twoslash include="examples/last/context-link/App.tsx"}
``` tsx
```
