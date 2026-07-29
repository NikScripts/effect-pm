# UI Route + Router — real router

**Landed on `integration`.** Anyone can use it. Same building blocks for every app.

## How it works

```ts
const site = Route.make("site").add(
  Route.get("home", "/home").pipe(Route.handle(() => <Home />)),
  Route.get("user", "/users/:id").pipe(
    Route.params(Schema.Struct({ id: Schema.String })),
    Route.handle(({ params }) => <User id={params.id} />),
  ),
)

const router = Router.make(site, "history")

<Router.Provider value={router}>
  <Router.Link to={(u) => u.home()}>Home</Router.Link>
  <Router.Outlet />   // renders the matched Route.handle
</Router.Provider>
```

| Piece | Job |
|--------|-----|
| `Route.get` + `handle` | Declare path **and** what to render |
| `Route.urlBuilder` | Typed URLs |
| `Router` | Location / match / go |
| `Router.Outlet` | Render the matched handle |

```text
URL → Router.match → Route.handle(args) → React node
```

That is the whole product story. No View registry required. No Group tag on Router.

## Catalog extras (optional)

| Tool | When |
|------|------|
| `Route.group` / `topLevel` | Nest / flatten URL builders |
| `Route.addHttpApi` | Reuse Effect HttpApi paths |
| `Group.asRoutes` + `fromEffect` | Generate destinations from a Group tree — **typed** UrlBuilder (`urls.Nwsl.HttpApi()`, health params, nested under `topLevel`) |
| `Route.Target` / `DashboardRoot` | Dashboard metadata (`selected` / `view`) — optional |

Group dashboards may still use Target + View skins in `DashboardShell`; ordinary apps use `handle` + `Outlet`.

## Runtime

| Method | History |
|--------|---------|
| `go` / `to` / `open*` | **push** (default); `{ replace: true }` ok |
| `up` / `toRoot` | **replace** |
| `back` | memory stack / `history.back()` |

`Router.memory` / `history` / `make` take a **Route catalog only**.

## Demo

| Run | What |
|-----|------|
| `pnpm run example:ui-router-mini-docs` | Typed catalog + match (Twoslash SSOT) |
| `pnpm run example:apps-router-docs` | Browser mini-docs on `handle` + `Outlet` (:5189) |

Doc page: [`docs/examples/ui/router-mini-docs.md`](../examples/ui/router-mini-docs.md).
