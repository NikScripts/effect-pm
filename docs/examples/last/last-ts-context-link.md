{#last-ts-context-link title="last-ts — context / link" status="stable" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> Rendered docs (Tailscale):
> <http://100.67.32.32:5192/docs/last-ts-context-link>
<!-- docs-site-link:end -->
# last-ts — Last.context / Last.link

Twoslash fences include the **full** runnable files under `examples/last/context-link/` (no `---cut---`); each fence shows its path.

**App:** [`examples/last/context-link/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/context-link/)  
**Run:** `pnpm run example:last-context-link`  
**Guide:** [Last.context](/docs/last-context) · **Lock:** [`last-context-view-lock.md`](../../handoffs/last-context-view-lock.md) (track 1 + T2e)

## Layout

```text
examples/last/context-link/
  ui/
    NavBar.tsx           leaves + Last.link + composition + NavBarContext
    DocsSidebar.tsx      docs-only region kit
  lib/
    Catalog.ts           path catalog for Last.link (no Site import)
    App.ts               .context(Site) + docs.context(DocsKit)
    SiteCopy / DocsCopy  content bags
    Site.ts / DocsKit.ts nested Last.context
    Tree / DocsTree      composition only (Last.use(App…))
    AppLayout / DocsLayout  Layout.make — place trees only
    routes.tsx           Layout.provide + Last.provideContext
    Provider.tsx         Last.provider(layer) — no second Site arg
  App.tsx                Provider > Router.Outlet
  main.ts                renderToString harness
```

## Value

- **Views** for every component slot (leaf DOM + composition)
- **`Last.link`**: direct home brand, group-narrowed `DocsLink`, uncalled
  `ChapterLink` (`slug` + `query` props), external `out`
- **T2e:** declare kits on the catalog (`.context`); fulfill with
  `Last.provideContext`; **no** `Last.provider(layer, Site)`
- Home mounts root Site only — docs kit stays off `/` (`data-docs` absent)

## Catalog (paths for Last.link)

{.twoslash include="examples/last/context-link/lib/Catalog.ts"}
``` ts
```

## App (scopes)

{.twoslash include="examples/last/context-link/lib/App.ts"}
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

## Docs kit

{.twoslash include="examples/last/context-link/lib/DocsKit.ts"}
``` ts
```

{.twoslash include="examples/last/context-link/ui/DocsSidebar.tsx"}
``` tsx
```

## Trees + layouts

{.twoslash include="examples/last/context-link/lib/Tree.tsx"}
``` tsx
```

{.twoslash include="examples/last/context-link/lib/DocsTree.tsx"}
``` tsx
```

{.twoslash include="examples/last/context-link/lib/AppLayout.tsx"}
``` tsx
```

{.twoslash include="examples/last/context-link/lib/DocsLayout.tsx"}
``` tsx
```

## Routes + Provider + App

{.twoslash include="examples/last/context-link/lib/routes.tsx"}
``` tsx
```

{.twoslash include="examples/last/context-link/lib/Provider.tsx"}
``` tsx
```

{.twoslash include="examples/last/context-link/App.tsx"}
``` tsx
```
