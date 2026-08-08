{#last-rsc-router title="RSC + Router" status="draft" appliesTo=last-ts}
# RSC + Router

How **last.ts** wires file pages + typed soft-nav. Surface: **last-ts docs
server** (`docs/last/site`) — not Hyperlink `docs/site`.

**Corrections SSOT:** [`../handoffs/last-ts-api-corrections.md`](../handoffs/last-ts-api-corrections.md)  
**Router lock:** [`../handoffs/router-httpapi-lock.md`](../handoffs/router-httpapi-lock.md)

## Split of jobs

| Layer | Job |
|-------|-----|
| Waku `src/pages/**` | RSC file bodies (plain default exports) |
| `Router.make` + `Route.get` | Typed catalog / `urls.*` |
| `Last.provider(Waku.layer.pipe(Layer.provide(routes)))` | Soft-nav provider |
| `View.make` + `View.mount` | Client islands |

## Forbidden

**Never** `getConfig`, `pageConfig`, `Page.asDefault`, Page introspection helpers
(`modeOf` / `optionsOf` / `extract` / `paramBagsOf` / `configOf`), or Route
`fromEffect` / `fromPage` / `*FromPages` catalog merges. Static vs dynamic is
owned by our Route/Page API — not Waku.

## Catalog

```ts
import { Schema } from "effect"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"

export class Site extends Router.make("last-ts").add(
  Route.get("index", "/"),
  Route.get("guides_slug", "/guides/:slug", {
    params: { slug: Schema.Literals(["routing", "view-service"]) },
  }),
  Route.get("docs_path", "/docs/*path", {
    params: { path: Schema.String },
  }),
) {}

export const urls = Route.urlBuilder(Site)
```

## File page (plain)

```tsx
export default function Chapter(props: { readonly slug: string }) {
  return <h1>{props.slug}</h1>
}
```

## Provider

```ts
export const Provider = Last.provider(
  Waku.layer.pipe(Layer.provide(routes)),
)
```

## Soft-nav

```ts
import { Link } from "last-ts/Waku"
import { urls } from "../lib/site"

<Link to={urls.index()}>Home</Link>
<Link to={urls.guides_slug("routing")}>Guide</Link>
```

## View DI

```ts
class Sidebar extends View.make<Sidebar>()("app/Sidebar", () => <nav />) {}
const App = View.mount(Shell)
// Prefer pipe(layer, Layer.provide(…)) over layer.pipe(…)
```

## Open (do not invent)

- Document title product API beyond `Page.Document` — owner lock first
- Combined provider story (one `Last.provider`) — do not invent nested provider recipes
- File-router (`paths.gen` / `fileRouter`) feature/standards write-up still owed
