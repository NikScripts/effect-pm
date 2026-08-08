{#last-rsc-router title="RSC + Router" status="draft" appliesTo=last-ts}
# RSC + Router

How **last.ts** wires file pages + typed soft-nav. Surface: **last-ts docs
server** (`docs/last/site`) — not Hyperlink `docs/site`, not an example app.

## Split of jobs

| Layer | Job |
|-------|-----|
| `Page.make` / `Page.static` classes | File page contract + request schemas |
| `paths.gen` + `Route.fileRootFromPages` | Typed catalog / `urls.*` (file ids) |
| `Last.provider(Waku.layer.pipe(Layer.provide(routes)))` | Soft-nav provider |
| Client islands (`View.Service`, …) | Interactive DI |

## Catalog

Drive the catalog from the generated path table. Merge **catalog twin** page
classes (shared options bags) — never import RSC page modules into the
Provider / client island graph.

```ts
import * as Page from "last-ts/Page"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"
import { fileEntries } from "./paths.gen"
import { chapterOptions } from "./chapter"

class GuidesSlug extends Page.static(chapterOptions) {}

export class Site extends Router.make("last-ts").add(
  Route.fileRootFromPages(fileEntries, {
    guides_slug: GuidesSlug,
  }),
) {}

export const urls = Route.urlBuilder(Site)
// urls.index() · urls.guides_slug("routing") · urls.docs_path("a/b")
```

Server tooling that *can* import page modules:

```ts
const pages = Router.pagesByIdFromModules(
  import.meta.glob("./pages/**/*.{tsx,ts}", { eager: true }),
)
// → { index, about, guides_slug, docs_path, view }
```

`Route.get` is **dynamic** by default. `Route.fromPage` / `fileRootFromPages`
copies the page’s options bag; `Page.static` + Literals attaches
`staticFromEffect` bags (no hand `paths` list).

## Page classes

```ts
import * as Page from "last-ts/Page"
import { Schema } from "effect"

class Chapter extends Page.static({
  params: { slug: Schema.Literals(["routing", "view-service"]) },
}) {
  static Component = (props: Page.Props<typeof Chapter>) => (
    <article>
      <h1>{props.params.slug}</h1>
    </article>
  )
}
export default Page.asDefault(Chapter)

class Home extends Page.static() {
  static Component = () => <h1>last.ts</h1>
}
export default Page.asDefault(Home)

// disk `[...path]` → `*path` / id `docs_path`
class DocsPath extends Page.make({
  params: { path: Schema.String },
}) {
  static Component = (props: Page.Props<typeof DocsPath>) => (
    <h1>{props.params.path}</h1>
  )
}
export default Page.asDefault(DocsPath)
```

Optional request options are the **first** argument (same bag as `Route.get`).
`Page.make` = dynamic; `Page.static` = bake. Use `Page.Props<typeof X>` outside
the class; inside `static Component`, prefer
`Page.PropsFromOptions<typeof options>` (avoids circular `typeof` on the class).
Waku’s default export is `Page.asDefault(…)` so the class brand stays for
`Page.extract`. **No** `pageConfig` / `Page.getConfig`. Param SSG and open
dynamic use Waku’s own `getConfig` on that file only (engine wire — see
`page-route-make-lock.md`). Mode itself is `Page.make` / `Page.static`.

## Provider

```ts
export const Provider = Last.provider(
  Waku.layer.pipe(Layer.provide(routes)),
)
```

PascalCase `Provider` — no rename at the import site.

## Soft-nav

```ts
import { Link } from "last-ts/Waku"
import { urls } from "../lib/site"

<Link to={urls.index()}>Home</Link>
<Link to={urls.guides_slug("routing")}>Guide</Link>
```
