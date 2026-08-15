# last-ts — Last.context / Last.link (track 1) + router fulfill (T2e)

**Lock:** [`docs/handoffs/last-context-view-lock.md`](../../../docs/handoffs/last-context-view-lock.md)  
**Twoslash:** [`docs/examples/last/last-ts-context-link.md`](../../../docs/examples/last/last-ts-context-link.md)

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

## Run

```bash
pnpm run example:last-context-link
```
