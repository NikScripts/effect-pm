{#last-rsc-router title="RSC + Router" status="draft" appliesTo=last-ts}
# RSC + Router

How **last.ts** wires file pages + typed soft-nav. Surface: **last-ts docs
server** (`docs/last/site`) — not Hyperlink `docs/site`, not an example app.

## Split of jobs

| Layer | Job |
|-------|-----|
| `Page.make` / `Page.static` classes | File page contract + request schemas |
| `Router.make` + `Route.get` | Typed catalog / `urls.*` |
| `Last.provider(Waku.layer.pipe(Layer.provide(routes)))` | Soft-nav provider |
| Client islands (`View.Service`, …) | Interactive DI |

## Catalog

```ts
import { Schema } from "effect"
import * as Page from "last-ts/Page"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"

class ChapterRoute extends Page.static({
  params: { slug: Schema.Literals(["routing", "view-service"]) },
}) {}

export class Site extends Router.make("last-ts").add(
  Route.get("home", "/"),
  Route.fromPage("chapter", "/guides/:slug", ChapterRoute),
) {}

export const urls = Route.urlBuilder(Site)
```

`Route.get` is **dynamic** by default. `Route.fromPage` copies the page’s
options bag; `Page.static` + Literals attaches `staticFromEffect` bags (no hand
`paths` list). Same bags type the links.

## Page classes

```ts
import * as Page from "last-ts/Page"
import { Schema } from "effect"

class Chapter extends Page.make({
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
```

Optional request options are the **first** argument (same bag as `Route.get`).
`Page.make` = dynamic; `Page.static` = bake. Not a Service. Waku’s default
export is `Page.asDefault(…)` so the class brand stays for `Page.extract`.

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

<Link to={urls.home()}>Home</Link>
<Link to={urls.chapter("routing")}>Guide</Link>
```
