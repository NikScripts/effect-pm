# last-ts — CMS → typed routes (`fromEffect`)

**Run:** `pnpm run example:last-from-effect`

A Layer-swappable `Cms` service decides which destinations exist and which
param/query shapes they use. Those Effects feed a normal catalog:

```ts
Router.make("cms-from-effect")
  .add(Route.get("home", "/"), content) // content = group.fromEffect(…)
  .groupsFromEffect(docsGroups);
```

| API | In this example |
|-----|-----------------|
| `group.fromEffect` | `product` (`:sku` + `?ref`), optional `variant` (`:sku/:variant` + `?ref`), `article` (`:locale/:slug` + `?preview`) |
| `groupsFromEffect` | optional `docs.guide` (`:version/:slug` + `?q`) |
| `Route.UrlBuilder<typeof Site>` | typed path args + `{ query }` |
| `RouterBuilder.layer(Site)` | bake `R` includes `Cms` |

Swap `cmsStorefront` vs `cmsDocsPortal` — same catalog module, different live grammar.
