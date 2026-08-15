{#last-rsc-router title="RSC + Router" status="draft" appliesTo=last-ts}
# RSC + Router

How **last.ts** wires file pages + typed soft-nav. Surface: **last-ts docs
server** (`docs/last/site`) — not Hyperlink `docs/site`.

**Corrections SSOT:** [`../handoffs/last-ts-api-corrections.md`](../handoffs/last-ts-api-corrections.md)  
**Router lock:** [`../handoffs/router-httpapi-lock.md`](../handoffs/router-httpapi-lock.md)

## Split of jobs

| Layer | Job |
|-------|-----|
| Waku host `createPages` + `adapter` (host entry only) | RSC host registration (no Waku `fsRouter`) |
| `last-ts/vite` `fileRouter` → `paths.gen.ts` | Typed file path table |
| `Router.make` + `Route.get` | Typed catalog / `urls.*` |
| `Last.provider(…)` + `last-ts/Waku` | Soft-nav provider |
| `View.make` + `Last.provide(Service, Service.layer)` | Client islands |

Apps **never** `import` from `waku`. Host CLI filenames (`waku.config.ts`,
`waku.server.tsx`) may remain; product imports are `last-ts/config` / `last-ts/Waku`
/ Page / catalog — not a `last-ts/server` product export.

## Forbidden

**Never** direct `waku` imports in apps, `getConfig`, `pageConfig`, `Page.asDefault`,
Page introspection / stamp helpers, or Route `fromPage` / `*FromPages`
catalog merges. (`group.effect` is core — not banned.)

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

## Soft-nav provider

```ts
import * as Last from "last-ts/Last"
import * as Waku from "last-ts/Waku"

export const provider = Last.provider(Waku.fromApi(Site))
```

## Client island

```ts
const App = Last.provide(Shell, Shell.layer)
```
