{#routing title="Routing" status="draft" appliesTo=all}

# Routing

Typed navigation for Hyperlink web apps: a **Route catalog**, a **Router** over
that catalog, and optional **GroupNav** for Group drill-down. The same API runs
as a **lite** Effect engine or a **full** Waku (RSC/SSG/SSR) edition.

```tsx
import * as Route from "hyperlink-ts/ui/Route"
import * as Router from "hyperlink-ts/ui/Router" // lite
// full: import * as Router from "hyperlink-ts/ui/Router/waku"

const site = Route.make("site").add(
  Route.get("home", "/").pipe(Route.handle(() => <Home />)),
  Route.get("docs", "/docs/:chapter").pipe(
    Route.params(Schema.Struct({ chapter: Schema.String })),
    Route.handle(({ params }) => <Chapter id={params.chapter} />),
  ),
)

const router = Router.make(site, "history") // lite
// full: const router = Router.waku(site)

<Router.Provider value={router}>
  <Router.Link to={(u) => u.home()}>Home</Router.Link>
  <Router.Link to={(u) => u.docs("work-pools")}>Work pools</Router.Link>
  <Router.Outlet />
</Router.Provider>
```

## Pieces

| Piece | Import | Job |
|-------|--------|-----|
| Catalog | `hyperlink-ts/ui/Route` | Paths, groups, `handle`, `urlBuilder` |
| Lite Router | `hyperlink-ts/ui/Router` | `make` / `memory` / `history` — Effect location |
| Full Router | `hyperlink-ts/ui/Router/waku` | `waku` / `make` — Waku soft-nav (optional `waku` peer) |
| GroupNav | `hyperlink-ts/ui/GroupNav` | Group tree open/up/health **on top of** either Router |
| Dashboard | `hyperlink-ts/web` / `tui` | Shell built **on** Router + GroupNav — not inside them |

```text
URL → Router.match(pathname) → Route.handle({ params, query, href }) → React node
urls.docs("work-pools", { query: { tab: "api" } }) → /docs/work-pools?tab=api
```

## Full vs lite

Same typed contract: catalog, `urls`, `Link` / `to` / `go` / `back` / `Outlet`,
`pathname` / `search` / `href` / `match`.

| Edition | Entry | Engine | Use when |
|---------|-------|--------|----------|
| **Full** | `hyperlink-ts/ui/Router/waku` | Waku | Website, RSC/SSG/SSR, dogfood |
| **Lite** | `hyperlink-ts/ui/Router` | `memory` / `history` | Tests, embeds, non-RSC apps |

```ts
// Lite
import * as Router from "hyperlink-ts/ui/Router"
const router = Router.make(site, "history")
// or Layer: Router.history(site) / Router.memory(site)

// Full
import * as Router from "hyperlink-ts/ui/Router/waku"
const router = Router.waku(site) // === Router.make(site)
```

Dashboard and other chrome call the same `to` / `Link` / `GroupNav` APIs on
whichever edition you provide.

## Catalog and URLs

Declare destinations once with `Route.make` / `Route.get` / `Route.group`.
Build hrefs with positional path args (template order), optional trailing
`{ query }`:

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

Optional: `Route.group` / `topLevel`, `Route.addHttpApi`, and
`Group.asRoutes` + `fromEffect` to generate typed destinations from a Group tree
(`urls.Nwsl.HttpApi()`, `urls.nodeHealth(id)`, …).

`fromEffect` only loads routes into the catalog. It does **not** stamp dashboard
behavior onto Router.

## Navigation

| API | Behavior |
|-----|----------|
| `router.to((u) => u.docs("x"))` | Push (default); `{ replace: true }` ok |
| `router.go("/path?q=1")` | Push/replace raw href |
| `Router.Link to={(u) => …}` | Soft-nav link (lite: history; full: Waku `Link`) |
| `router.back()` | Memory stack or `history.back()` / Waku back |
| `router.toRoot()` | Replace to `/` |
| `router.prefetch(href)` | Full edition; no-op on lite |
| `Router.Outlet` | Renders matched `Route.handle` (or `null`) |

## GroupNav (on top)

Group drill-down is **not** part of core Router. Pass the Group root explicitly:

```tsx
import * as GroupNav from "hyperlink-ts/ui/GroupNav"

const nav = GroupNav.use(ServicesHub)
nav.open(HttpApi)           // → /Nwsl/HttpApi
nav.up()                    // replace one segment
nav.openHealth()            // → urls.health() when present
nav.openNode("app/NodeA")   // → urls.nodeHealth(…)
```

`Route.Target` annotations from `Group.asRoutes` feed selected member / view.
Works with lite or full Router underneath. See [Dashboard](/docs/dashboard).

## Docs site (Waku dogfood)

The public docs app uses the **full** edition:

| Layer | Owns |
|-------|------|
| `docs/site/src/pages/**` + `pages.gen` | Render / Twoslash / RSC-SSR file routes |
| `catalog` in `siteRoutes.ts` | Typed nav paths (written once) |
| `hyperlink-ts/ui/Router/waku` | Soft-nav engine |
| Site `ui/Router.tsx` | Thin skin: branded `urls`, `setDefault(docs)`, no-op `Outlet` |

Waku `[param]` templates are derived from Route paths (`ToWaku` / `toWaku`).
`test/site-routes.test-d.ts` fails if catalog and `pages.gen` disagree
(intentional exclusions: `/_root`, specialized static API paths).

Chapter bodies stay in file routes — `Outlet` is a no-op on the docs site so
Twoslash SSG is preserved. In-app chrome uses `Router.Link` / `router.to` with
`urls.*` (not raw `/api/…` strings).

Static vs dynamic **render** is separate from routing: each page’s `getConfig`
chooses `render: "static" | "dynamic"` and optional `staticPaths`. Soft-nav only
changes how the browser loads a URL that already has a render mode.

## Render mode (Waku pages)

```ts
// Fixed page
export const getConfig = async () => ({ render: "static" } as const)

// Param routes — list paths to SSG; SSR the rest (or all dynamic in dev)
export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({ render: "static", staticPaths: chapters.map((c) => c.slug) } as const)
```

Literal segments beat params (e.g. static `/api/hyperlink-ts/…` vs dynamic
`/api/[pkg]/…`). See the docs site’s API symbol routes for the mix.

## Examples

| Run | What |
|-----|------|
| `pnpm run example:ui-router-mini-docs` | Typed catalog + match |
| `pnpm run example:apps-router-docs` | Browser mini-docs on `handle` + `Outlet` (:5189) |

Guide page: [UI — Router mini-docs](/docs/ui-router-mini-docs).

## Still tightening

Held to the same standards as the rest of the package; in flight or next:

- Branded `Route.Href` (no bare strings at Router boundaries)
- Schema encode/decode on `params` / query for `urls` + `handle`
- Deeper exhaustiveness for runtime href fulfillment beyond catalog ↔ `pages.gen`
