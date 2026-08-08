# Page.make + Route.fromEffect — lock

**Branch:** `cursor/file-router-prototype-125f`  
**Status:** Eng’d on tip (API surface)

## Locked

```ts
// Page classes (HttpApi-shaped) — options optional **first** arg
export default class Chapter extends Page.make({
  params: { slug: Schema.Literals(["routing", "view-service"]) },
}) {
  static Component = (props: Page.Props<Chapter>) => …
}

export default class Home extends Page.static() { … } // SSG opt-in
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

- File-router loader reading `Page.make` class → catalog merge / Waku config inject (no app `getConfig`)
- Mixed static+dynamic **two** literal sets on one `Route.get` (annotation helper polish)
- `group.fromEffect` emitting full param unions

## Surface

- **`docs/last/site`** — last-ts docs server (`pnpm run docs:last-site` → `:5220`)
- Removed `examples/apps/last-ts-site` (was never the product surface)
