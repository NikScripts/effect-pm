{#last-rsc-router title="RSC + Router" status="draft" appliesTo=last-ts}
# RSC + Router

How **last.ts** wires file pages + typed soft-nav. Surface: **last-ts docs
server** (`docs/last/site`) — not Hyperlink `docs/site`.

**Corrections SSOT:** [`../handoffs/last-ts-api-corrections.md`](../handoffs/last-ts-api-corrections.md)  
**Router lock:** [`../handoffs/router-httpapi-lock.md`](../handoffs/router-httpapi-lock.md)

## Split of jobs

| Layer | Job |
|-------|-----|
| `last-ts/server` (`createPages` + `adapter`) | RSC host registration (no Waku `fsRouter`) |
| `last-ts/vite` `fileRouter` → `paths.gen.ts` | Typed file path table |
| `Router.make` + `Route.get` | Typed catalog / `urls.*` |
| `Last.provider(…)` + `last-ts/Waku` | Soft-nav provider |
| `View.make` + `Last.provide` | Client islands |

Apps **never** `import` from `waku`. Host CLI filenames (`waku.config.ts`,
`waku.server.tsx`) may remain; imports are `last-ts/config` / `last-ts/server`.

## Forbidden

**Never** direct `waku` imports, `getConfig`, `pageConfig`, `Page.asDefault`,
Page introspection helpers, or Route `fromEffect` / `fromPage` / `*FromPages`
catalog merges.

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

## Host server entry

```tsx
import * as Server from "last-ts/server"
import { Home } from "./pages/index"
import { Chapter } from "./pages/guides/[slug]"

export default Server.adapter(
  Server.createPages(async ({ createPage, createRoot }) => [
    createRoot({ render: "static", component: Root }),
    createPage({ ...Server.fromPage("/", Home) }),
    createPage({
      ...Server.fromPage("/guides/[slug]", Chapter),
      staticPaths: ["routing"],
    }),
  ]),
)
```

Page components take soft-nav props (`params.slug`). `Server.fromPage(path, mint)`
adapts Waku’s flat `{ slug, path, query }` at the host boundary.

## Provider

```ts
export const Provider = Last.provider(
  pipe(Waku.layer, Layer.provide(routes)),
)
```

## Soft-nav

```ts
import * as Router from "last-ts/Router"
import { Site, urls } from "../lib/site"

export const Link = Router.link(Site)

<Link to={urls.index()}>Home</Link>
<Link to={urls.guides_slug("routing")}>Guide</Link>
```

Waku is only the location Layer (`Waku.layer` / `Waku.fromApi`) — not a Link API.

## View DI

```ts
class Sidebar extends View.make<Sidebar>()("app/Sidebar", () => <nav />) {}
const App = View.stamp(Last.provide(Shell))
// Prefer pipe(layer, Layer.provide(…)) over layer.pipe(…)
```

## Spine

Full walkthrough: [`../handoffs/last-ts-spine.md`](../handoffs/last-ts-spine.md).
