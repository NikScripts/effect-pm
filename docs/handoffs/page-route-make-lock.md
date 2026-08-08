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

- File-router loader reading `Page.make` class → catalog merge
- `pageConfig` Vite inject → expand `Page.static` + Literals into Waku `staticPaths`
- Mixed static+dynamic **two** literal sets on one `Route.get` (annotation helper polish)
- `group.fromEffect` emitting full param unions

## Eng’d inject

- `last-ts/vite` `pageConfig()` — stamps Waku `getConfig` from `Page.make`/`Page.static` (apps never write it). Waku fs-router defaults pages to static; slug routes need the dynamic override.

## Surface

- **`docs/last/site`** — last-ts docs server (`pnpm run docs:last-site` → `:5220`)
- Removed `examples/apps/last-ts-site` (was never the product surface)
