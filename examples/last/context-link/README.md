# last-ts — Last.context / Last.link

**Lock:** [`docs/handoffs/last-context-view-lock.md`](../../../docs/handoffs/last-context-view-lock.md)  
**Twoslash:** [`docs/examples/last/last-ts-context-link.md`](../../../docs/examples/last/last-ts-context-link.md)

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

## Run

```bash
pnpm run example:last-context-link
```
