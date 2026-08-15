{#last-ts-router-context title="last-ts — router context" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> Rendered docs (Tailscale):
> <http://100.67.32.32:5192/docs/last-ts-router-context>
<!-- docs-site-link:end -->
# last-ts — router-scoped Last.context

{.draft}
**Draft** — Twoslash fences include the **full** runnable files under
`examples/last/router-context/` (no `---cut---`); each fence shows its path.

**App:** [`examples/last/router-context/`](https://github.com/nikolasstow/Hyperlink/blob/integration/examples/last/router-context/)  
**Run:** `pnpm run example:last-router-context`  
**Lock:** [`last-context-view-lock.md`](../../handoffs/last-context-view-lock.md) (track 2)

## Layout

```text
examples/last/router-context/
  ui/
    NavBar.tsx           leaves + composition + NavBarContext
    Frame.tsx            leaves + Outlet host + FrameContext
    DocsSidebar.tsx      docs-only region kit
  lib/
    Catalog.ts           path catalog + `Link = Router.link(Catalog)`
    App.ts               .context(Site) + docs.context(DocsKit)
    Site.ts / DocsKit.ts nested Last.context bags
    AppTree / DocsTree   composition only (Last.use(App…))
    AppLayout / DocsLayout  Layout.make — place trees only (no HTML)
    routes.tsx           Layout.provide + Last.provideContext
    Provider.tsx         Last.provider(layer) — no second Site arg
  App.tsx                Provider > Router.Outlet
  main.ts                renderToString harness
```

## Value

- **Declare** kits on the catalog / group (`.context`)
- **Fulfill** on the builder with `Last.provideContext` (Layout dual)
- **Mount** active-path bag bridges in `Router.Outlet`
- **`Last.use(App)`** / `Last.use(App, "docs")` under the match
- Leaf Views own DOM; composition / Layout / Tree = **zero HTML**
- No `Last.provider(layer, Site)` at the app edge

## Catalog (paths) + App (scopes)

{.twoslash include="examples/last/router-context/lib/Catalog.ts"}
``` ts
```

{.twoslash include="examples/last/router-context/lib/App.ts"}
``` ts
```

## Site + DocsKit

{.twoslash include="examples/last/router-context/lib/Site.ts"}
``` ts
```

{.twoslash include="examples/last/router-context/lib/DocsKit.ts"}
``` ts
```

## NavBar

{.twoslash include="examples/last/router-context/ui/NavBar.tsx"}
``` tsx
```

## Frame

{.twoslash include="examples/last/router-context/ui/Frame.tsx"}
``` tsx
```

## DocsSidebar

{.twoslash include="examples/last/router-context/ui/DocsSidebar.tsx"}
``` tsx
```

## Trees + layouts

{.twoslash include="examples/last/router-context/lib/AppTree.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/lib/DocsTree.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/lib/AppLayout.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/lib/DocsLayout.tsx"}
``` tsx
```

## Builder

{.twoslash include="examples/last/router-context/lib/routes.tsx"}
``` tsx
```

## Provider + App

{.twoslash include="examples/last/router-context/lib/Provider.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/App.tsx"}
``` tsx
```

## Notes

- Edge bake uses `Layer.provideMerge` (Memory ↔ routes) so `Last.provideContext` kit
  services stay in the Atom runtime Context for `Last.use`.
- Group layers are also `provideMerge`d into `RouterBuilder.layer` for the same reason.
