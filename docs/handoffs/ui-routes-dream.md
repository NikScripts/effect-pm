# UI Route + Router — dream machine

**Landed on `integration`.** One vision API for every app — including the docs site (Waku-backed skin).

## How it works

```ts
const site = Route.make("site").add(
  Route.get("home", "/home").pipe(Route.handle(() => <Home />)),
  Route.get("user", "/users/:id").pipe(
    Route.params(Schema.Struct({ id: Schema.String })),
    Route.handle(({ params, query }) => (
      <User id={params.id} tab={query.tab} />
    )),
  ),
)

const router = Router.make(site, "history")

<Router.Provider value={router}>
  <Router.Link to={(u) => u.home()}>Home</Router.Link>
  <Router.Link to={(u) => u.user("42", { query: { tab: "bio" } })}>
    User
  </Router.Link>
  <Router.Outlet />   // renders the matched Route.handle
</Router.Provider>
```

| Piece | Job |
|--------|-----|
| `Route.get` + `handle` | Declare path **and** what to render |
| `Route.urlBuilder` | Typed URLs — **path segments as args**, optional `{ query }` last |
| `Router` | Location / match / go (`pathname` + `search` / `href`) |
| `Router.Outlet` | Render the matched handle (`params` + `query`) |

```text
URL → Router.match(pathname) → Route.handle({ params, query, href }) → React node
urls.user("42", { query: { tab: "bio" } }) → /users/42?tab=bio
```

That is the whole product story. No View registry required. No Group tag on Router.

## Call shape (the dream)

```ts
urls.home()
urls.docs("work-pools")
urls.api.symbol("effect", "Effect", "succeed")
urls.nodeHealth("app/NodeA", { query: { panel: "logs" } })
// → /health/app/NodeA?panel=logs   (*nodeId splat keeps `/`)
```

Not `{ params: { chapter } }` — path keys are positional in template order.
`:name` = one segment; `*name` = rest (slashes ok), must be last.
Query is UI navigation only (no HTTP body).

## Catalog extras (optional)

| Tool | When |
|------|------|
| `Route.group` / `topLevel` | Nest / flatten URL builders |
| `Route.addHttpApi` | Reuse Effect HttpApi paths |
| `Group.asRoutes` + `fromEffect` | Generate destinations from a Group tree — **typed** UrlBuilder (`urls.Nwsl.HttpApi()`, `urls.nodeHealth(id)`) |
| `Route.Target` / `GroupNav` | Optional Group dashboard state and URL helpers over a core Router |

Group dashboards use `GroupNav.use(root)` with Target + View skins in `DashboardShell`; ordinary apps use `handle` + `Outlet`.

## Docs site

Same API. Waku file routes are **render SSOT**; `siteRoutes.catalog` is the typed nav SSOT (paths once; Waku templates derived) and is exhaustively checked against `pages.gen`. `Router.Outlet` is a no-op there. Skin adds `urls.api.symbol("effect", "Effect.succeed")` overload. See [`waku-site-routes-api.md`](./waku-site-routes-api.md).

## Runtime

| Method | History |
|--------|---------|
| `Router.go` / `to` | **push** (default); `{ replace: true }` ok — href may include `?query` |
| `GroupNav.open*` | **push** to Group and health URLs |
| `GroupNav.up` / `Router.toRoot` | **replace** |
| `back` | memory stack / `history.back()` |

`Router.memory` / `history` / `make` take a **Route catalog only**.

## Demo

| Run | What |
|-----|------|
| `pnpm run example:ui-router-mini-docs` | Typed catalog + match (Twoslash SSOT) |
| `pnpm run example:apps-router-docs` | Browser mini-docs on `handle` + `Outlet` (:5189) |

Doc page: [`docs/examples/ui/router-mini-docs.md`](../examples/ui/router-mini-docs.md).
