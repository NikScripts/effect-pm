# UI Route + Router — dream machine

**Landed on `integration`.** Public surface: `ui/Route` + `ui/Router`. Group trees enter via `Group.asRoutes` + `fromEffect` — never as a Router argument.

## Catalog (`Route`) — typed data

| Effect | Route |
|--------|--------|
| `HttpApi.make` | `Route.make` |
| `HttpApiGroup.make` | `Route.group` |
| `HttpApiEndpoint.get` | `Route.get` |
| `HttpApi.addHttpApi` | `Route.addHttpApi` / `api.addHttpApi` |
| `HttpApiClient.urlBuilder` | `Route.urlBuilder` (**typed**) |
| `HttpApi.reflect` | `Route.reflect` |
| *(dynamic)* | `Route.group(…).fromEffect(effect)` |

```ts
const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
)

Route.urlBuilder(site).home()
Router.history(site) // Api only — never a Group tag
```

`Group.asRoutes` is the Group → destinations bridge. `fromEffect` stamps `Route.DashboardRoot` so dashboard helpers (`open` / `path` / …) can recover the tree without Router taking a tag.

## Runtime (`Router`)

```ts
const router = Router.make(site, "memory")
router.to((urls) => urls.home())

Router.history(site)
Router.memory(site)

View.compose({ views, router: Router.history(site) })
```

| Method | History |
|--------|---------|
| `go` / `to` / `open*` | **push** (default); `{ replace: true }` ok |
| `up` / `toRoot` | **replace** |
| `back` | memory stack / `history.back()` |

## Public surface

- **`ui/Route`** — catalog data (+ `fromEffect` on groups)
- **`ui/Router`** — runtime (`memory` / `history` / `make` over **Api only**)
- **`Group.asRoutes`** — Effect of destinations for a Group tree

Removed: `Navigator`, `GroupRoute`, `useGroupRoute`, **`Router.makeGroup`**, **`Router.memory|history(Group)`**.

## Not inventing

- No nested outlets / guards / query as kit product without owner ask  
