# Page.make + Route.fromEffect — lock

**Branch:** `cursor/agent-k-page-route-6d0e`  
**Status:** Eng’d (API surface + `pages.gen` align)

## Locked

```ts
// Page classes (HttpApi-shaped) — options optional **first** arg
class Chapter extends Page.make({
  params: { slug: Schema.Literals(["routing", "view-service"]) },
}) {
  static Component = (props: Page.Props<typeof Chapter>) => …
}
export default Page.asDefault(Chapter)

class Home extends Page.static() { … } // SSG opt-in
export default Page.asDefault(Home)
// Page.make = dynamic (default). No Page.Service. No Page.dynamic name.

// Route.get = dynamic by default
Route.get("chapter", "/guides/:slug").pipe(
  Route.staticFromEffect(loadRows), // literal bags → bake
)
Route.get("chapter", "/guides/:slug").pipe(
  Route.fromEffect(loadRows), // typed bags, SSR
)

// Shared RequestOptions bag (params / query / headers / error)
// No manual paths: list. No Literal|String unions.
// Param shape = union of bags (from effect rows / Literals), not struct-of-unions.
// File disk: [slug]→:slug, [...path]→*path
```

## Eng’d inject / merge

- `Page.configOf(page)` — `{ render }` + `staticPaths` from `Schema.Literals` params
- `Page.paramBagsOf(page)` — union-of-bags for `Route.staticFromEffect`
- `last-ts/vite` `pageConfig()` — stamps `export const getConfig = () => Page.configOf(X)` (apps never write it); aligns Waku `pages.gen.ts` literal `render` modes (`Page.make` → `dynamic`) after typegen
- `Route.fromPage(id, path, page)` — options + static Literals → catalog route
- `Router.destinationsFromPages(entries, { id: PageClass })` — path table + page merge
- `Route.fileRootFromPages` / `Router.fileSystemFromPages` — path table + page merge as catalog root
- `Router.pagesByIdFromModules(glob)` — Vite eager glob → `{ [routeId]: Page }` (server tooling; not Provider)
- `Route.mixedFromEffect({ static, dynamic })` — two closed literal sets; only static bakes
- `~ParamBags` / `Route.WithParamBags` + UrlBuilder positional bag-union args (survives `group.add` / topLevel)

## Dogfood (`docs/last/site`)

- Catalog: `Route.fileRootFromPages(fileEntries, { guides_slug: GuidesSlug })` — ids match `paths.gen`
- Catalog twins from shared `chapterOptions` (Provider stays RSC-safe)
- Chapter file page is `Page.static` → injected `staticPaths`
- Rest page: `pages/docs/[...path]` → `docs_path` / `/docs/*path`

## Surface

- **`docs/last/site`** — last-ts docs server (`pnpm run docs:last-site` → `:5220`)
- Removed `examples/apps/last-ts-site` (was never the product surface)
