# Page.make + Route.fromEffect — lock

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng’d on tip (API surface)

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

## Not yet

- Wire `pagesByIdFromModules` + `paths.gen` into a real app catalog (RSC Provider must not import page modules — keep shared options / server-only catalog)
- `group.fromEffect` emitting full param unions

## Eng’d inject / merge

- `Page.configOf(page)` — `{ render }` + `staticPaths` from `Schema.Literals` params
- `Page.paramBagsOf(page)` — union-of-bags for `Route.staticFromEffect`
- `last-ts/vite` `pageConfig()` — stamps `export const getConfig = () => Page.configOf(X)` (apps never write it)
- `Route.fromPage(id, path, page)` — options + static Literals → catalog route
- `Router.destinationsFromPages(entries, { id: PageClass })` — path table + page merge
- `Router.pagesByIdFromModules(glob)` — Vite eager glob → `{ [routeId]: Page }`
- `Route.mixedFromEffect({ static, dynamic })` — two closed literal sets; only static bakes

## Surface

- **`docs/last/site`** — last-ts docs server (`pnpm run docs:last-site` → `:5220`)
- Removed `examples/apps/last-ts-site` (was never the product surface)
