# UI Route + Router — dream machine

**Branch:** `cursor/view-withsize-types-125f` · **Landed / landing to `integration`.**

## Catalog (`Route`) — typed data

| Effect | Route |
|--------|--------|
| `HttpApi.make` | `Route.make` |
| `HttpApiGroup.make` | `Route.group` |
| `HttpApiEndpoint.get` | `Route.get` |
| `HttpApi.addHttpApi` | `Route.addHttpApi` / `api.addHttpApi` |
| `HttpApiClient.urlBuilder` | `Route.urlBuilder` (**typed**) |
| `HttpApi.reflect` | `Route.reflect` |

Generics survive `.add` (tuple-fold, no union-split). Nested groups nest on the builder; `topLevel` flattens.

```ts
const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.get("node", "/health/:nodeId").pipe(
    Route.params(Schema.Struct({ nodeId: Schema.String })),
  ),
  Route.group("app").add(Route.get("dashboard", "/app")),
  Route.addHttpApi(wire),
)

Route.urlBuilder(site).home()
Route.urlBuilder(site).app.dashboard()
Route.urlBuilder(site).node({ params: { nodeId: "1" } }) // params required
```

`Route.Target` annotation stamps Group-built destinations; Router reads `selected` / `view` from match.

## Runtime (`Router`)

```ts
// Typed value (prefer when you hold the catalog):
const router = Router.make(site, "memory")
router.to((urls) => urls.app.dashboard())

// Layer for DI / View.compose (catalog type erased on Context):
Router.history(site)
Router.memory(ServicesHub) // Group → catalog via Route.make/group/get loops

// compose accepts Layer **or** a live router value:
View.compose({ views, router: Router.history(Hub) })
View.compose({ views, router: Router.make(site, "memory") })

<Router.Link to={(urls) => urls.home()}>Home</Router.Link>
Route.targetOf(router.match) // Target annotation | undefined
Route.urlBuilder(site, { baseUrl: "https://example.com" })
```

| Method | History |
|--------|---------|
| `go` / `to` / `open*` | **push** (default); `{ replace: true }` ok |
| `up` / `toRoot` | **replace** |
| `back` | memory stack / `history.back()` |

Group helpers throw on bare catalogs (fail loud).
React helpers: `useRouter` / `useMatch` / `useTarget` / `Link`.

## Public surface

- **`ui/Route`** — catalog data
- **`ui/Router`** — runtime (`Context.Service` tag + `memory` / `history` / `make`)

Removed: `Navigator`, public `ui/GroupRoute`, `web/useGroupRoute`, `tui/useGroupRoute`.
Group path walk + catalog build live under `src/internal/uiGroupRoutes.ts`.

## Not inventing

- No public `fromMembers` / Group-Tag route helper  
- Catalog stays data (not a Context service)  
- No new ViewKinds for logs/schedule  
- No nested outlets / guards / query as kit product without owner ask  
