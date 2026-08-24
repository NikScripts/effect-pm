{#routing title="Routing" status="stable" appliesTo=all}

# Routing

Typed navigation: a **Route catalog**, one live **Router** service, and
optional **GroupNav** for Group drill-down. Install the service with
`Memory` / `History` / `Waku` under **`Last.provider`**.

```tsx
import { pipe, Layer } from "effect"
import * as Last from "last-ts/Last"
import * as History from "last-ts/History"
import * as Route from "last-ts/Route"
import * as Router from "last-ts/Router"
import * as RouterBuilder from "last-ts/RouterBuilder"

class Site extends Router.make("site").add(
  Router.group("app").add(
    Route.get("home", "/"),
    Route.get("docs", "/docs/:chapter").pipe(
      Route.params(Schema.Struct({ chapter: Schema.String })),
    ),
  ),
) {}

const app = pipe(
  RouterBuilder.group(Site, "app", (h) =>
    h.handle("home", Home).handle("docs", ({ params }) => (
      <Chapter id={params.chapter} />
    )),
  ),
)
const routes = pipe(RouterBuilder.layer(Site), Layer.provide(app))
export const Provider = Last.provider(
  pipe(History.layer, Layer.provide(routes)),
)

const Link = Router.link(Site)
// <Provider><Link to={(u) => u.app.home()}>Home</Link><Router.Outlet /></Provider>
```

Catalog-only soft-nav (no Outlet handlers — dashboards / RSC file routes):

```ts
export const Provider = Last.provider(History.fromApi(site))
// or Memory.fromApi(site) / Waku.fromApi(site)
```

## Pieces

| Piece | Import | Job |
|-------|--------|-----|
| Catalog | `last-ts/Route` / `last-ts/Router` | Paths, groups, `handle`, `urlBuilder` |
| Handlers | `last-ts/RouterBuilder` | Page / Effect handlers + layouts |
| Transport | `last-ts/Memory` · `History` · `Waku` | `.layer` (+ builder) or `.fromApi` (catalog-only) |
| Edge | `last-ts/Last` | `Last.provider(layer)` — one children-only bake |
| GroupNav | `hyperlink-ts/ui/GroupNav` | Group tree open/up/health **on top of** Router |
| Dashboard | `hyperlink-ts/web` / `tui` | Shell built **on** Router + GroupNav |

```text
URL → Router.match(pathname) → handler / Route.handle → React node
urls.docs("work-pools", { query: { tab: "api" } }) → /docs/work-pools?tab=api
```

## One service, three transports

Same `Router.Service`: catalog, `urls`, `Link` / `to` / `go` / `back` /
`Outlet`, `pathname` / `search` / `href` / `match`, `prefetch`.

| Transport | Install | Use when |
|-----------|---------|----------|
| **Memory** | `Memory.layer` + `RouterBuilder` · or `Memory.fromApi(site)` | Tests, TUI, embeds |
| **History** | `History.layer` + `RouterBuilder` · or `History.fromApi(site)` | SPA / web dashboard |
| **Waku** | `Waku.layer` + `RouterBuilder` · or `Waku.fromApi(site)` | RSC / SSG soft-nav |

```ts
import * as Last from "last-ts/Last"
import * as Memory from "last-ts/Memory"
import * as Waku from "last-ts/Waku"

export const Provider = Last.provider(Memory.fromApi(site))
// RSC soft-nav:
export const Provider = Last.provider(Waku.fromApi(Site))
export const Link = Router.link(Site)
```

## Discriminants

| Value | Discriminant | Notes |
|-------|--------------|-------|
| Live `Router.Service` | `_tag: "Memory" \| "History" \| "Waku"` | Set by the transport Layer |
| `Route.TargetValue` | `_tag: "Group" \| "Leaf" \| "LeafView" \| "Health"` | From `Group.asRoutes` |
| Path templates (internal) | `_tag: "Lit" \| "Param" \| "Splat"` | Compiler tokens for `:name` / `*name` |

## Catalog and URLs

```ts
const urls = Route.urlBuilder(site)

urls.home()
urls.docs("work-pools")
urls.docs("work-pools", { query: { tab: "api" } })
urls.nodeHealth("app/NodeA") // /health/*nodeId keeps slashes
```

| Template | Meaning |
|----------|---------|
| `:name` | One path segment |
| `*name` | Rest of path (slashes ok); must be last |
| `{ query }` | UI search string only (not an HTTP body) |

Optional: `Route.group` / `topLevel`, `Router.addHttpApi`, and
`Group.asRoutes` + `group.effect` to generate typed destinations from a Group
tree (`urls.Nwsl.HttpApi()`, `urls.nodeHealth(id)`, …).

`group.effect` only loads routes into the catalog. It does **not** stamp
dashboard behavior onto Router.

## Navigation

| API | Behavior |
|-----|----------|
| `router.to((u) => u.docs("x"))` | Push (default); `{ replace: true }` ok |
| `router.go("/path?q=1")` | Push/replace raw href |
| `Router.link(catalog)` | Soft-nav link (`Service.go` — Memory / History / Waku) |
| `router.back()` | Memory stack or `history.back()` / Waku back |
| `router.toRoot()` | Replace to `/` |
| `router.prefetch(href)` | Waku; no-op on lite |
| `Router.Outlet` | Matched `RouterBuilder` handler or `Route.handle` |

## GroupNav (on top)

```tsx
import * as GroupNav from "hyperlink-ts/ui/GroupNav"

const nav = GroupNav.use(ServicesHub)
nav.open(HttpApi)           // → /Nwsl/HttpApi
nav.up()                    // replace one segment
nav.openHealth()            // → urls.health() when present
nav.openNode("app/NodeA")   // → urls.nodeHealth(…)
```

See [Dashboard](/docs/dashboard) and [Dashboard compose](/docs/dashboard-compose).
Runnable: [GroupNav + Target](/docs/ui-group-nav).

## Docs site (Waku dogfood)

| Layer | Owns |
|-------|------|
| `docs/site/src/pages/**` | File routes (RSC) |
| Catalog | Typed nav paths |
| Soft-nav | `Last.provider(Waku.fromApi(…))` in book `_layout` |
| Host entry | `waku.server.tsx` — Waku `createPages` is **host wiring**, not app API |

Never teach app-level `getConfig`, `createPages`, or `import … from "waku"`.
Render mode for host registration lives on the host entry / `Page.static` —
not per-file `getConfig`. Soft-nav only changes how the browser loads a URL.

## File-router path table

See [File router](/docs/file-router) — Vite `fileRouter`, `paths.gen.ts`,
`Route.fileRoot`. Soft-nav still uses this Router; the path table fills the
catalog. No auto-merge into `Router.make` or host `createPages`.

## Examples

| Run | What |
|-----|------|
| `pnpm run example:ui-router-mini-docs` | Typed catalog + match |
| `pnpm run example:apps-router-docs` | Browser mini-docs on `handle` + `Outlet` |
| `pnpm run example:ui-group-nav` | GroupNav + Target |
| `pnpm run example:ui-file-router-codegen` | Codegen unions + `Route.fileRoot` |
| `pnpm run example:apps-dashboard` | Batteries web Dashboard |

## last-ts — RSC + Router

→ **[RSC + Router](/docs/rsc-router)** (`docs/last/rsc-router.md`)

```bash
pnpm run docs:last-site   # docs/last/site
```

## Still tightening

- Branded `Route.Href` (parked — see
  [`owned-string-casing-park.md`](../handoffs/owned-string-casing-park.md))
- Schema encode/decode on `params` / query for `urls` + `handle`
