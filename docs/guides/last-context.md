{#last-context title="Last.context (View kits + router scopes)" status="stable" appliesTo=last-ts}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/last-context>.
<!-- docs-site-link:end -->
# Last.context — View kits and router scopes

**Lock:** [`last-context-view-lock.md`](../handoffs/last-context-view-lock.md)  
**Examples hub:** [Examples → UI](/docs/examples#ui)

Component slots are **Views**. Region kits are **`Last.context`**. Soft-nav apps
**declare** kits on the catalog (`.context`), **fulfill** them on the builder
(`Last.provideContext`), and **read** them with `Last.use` under `Router.Outlet`.

No `static layer`. No `Last.provider(layer, Site)` at the app edge.

## End-state

```ts
// 1) Declare scopes on the catalog
class App extends Router.make("app")
  .context(Site)
  .add(
    Router.group("docs")
      .context(DocsKit)
      .add(Route.get("chapter", "/docs/:slug")),
  ) {}

// 2) Builder — Layout dual for kits
const docs = pipe(
  RouterBuilder.group(App, "docs", (h) => h.handle("chapter", Chapter)),
  Layout.provide(DocsLayout),
  Last.provideContext(DocsKit, docsKitLayer),
)

const root = pipe(
  RouterBuilder.layer(App),
  Layer.provideMerge(Layer.mergeAll(main, docs)),
  Last.provideContext(Site, siteLayer),
)

// 3) One edge bake
export const Provider = Last.provider(
  pipe(Memory.layer, Layer.provideMerge(root)),
)

// 4) Use under the match
const { NavBar } = Last.use(App)
const docsBag = Last.use(App, "docs")
```

Home mounts root Site only — the docs kit stays off `/` until you navigate.

## Views (leaf HTML)

Leaf Views own DOM via `View.make` defaults. Composition Layers `yield*` them —
see [Typed Views](/docs/view-typed-jsx).

## Track 2 demo (router scopes)

Full files under `examples/last/router-context/` — Twoslash includes are the
runnable SSOT.

**Run:** `pnpm run example:last-router-context`  
**Page:** [last-ts router context](/docs/last-ts-router-context)

### Catalog + scopes

{.twoslash include="examples/last/router-context/lib/Catalog.ts"}
``` ts
```

{.twoslash include="examples/last/router-context/lib/App.ts"}
``` ts
```

### Fulfill + edge

{.twoslash include="examples/last/router-context/lib/routes.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/lib/Provider.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/App.tsx"}
``` tsx
```

### Use

{.twoslash include="examples/last/router-context/lib/AppTree.tsx"}
``` tsx
```

{.twoslash include="examples/last/router-context/lib/DocsTree.tsx"}
``` tsx
```

## Last.link (track 1 surface, T2e edge)

Named / narrowed links live with the region kit. The context-link demo keeps
`Last.link` teaching and uses the same `.context` + `Last.provideContext` edge
(no `provider(layer, Site)`).

**Run:** `pnpm run example:last-context-link`  
**Page:** [last-ts context / link](/docs/last-ts-context-link)

{.twoslash include="examples/last/context-link/ui/NavBar.tsx"}
``` tsx
```

{.twoslash include="examples/last/context-link/lib/Provider.tsx"}
``` tsx
```

## Related

- [Typed Views](/docs/view-typed-jsx) — `View.make` + const Layer + `Last.provide`
- [RSC + Router](/docs/rsc-router) — file pages + soft-nav host boundary
- [last-ts spine](/docs/last-ts-spine) — Page mint → catalog → `Last.provider`
