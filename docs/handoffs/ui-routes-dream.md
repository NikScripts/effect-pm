# UI Route + Router

**Locked (owner 2026-07-29)** · Navigator cutover + refinements on `cursor/view-withsize-types-125f`

## Catalog (`Route`) — data

| Effect | Route |
|--------|--------|
| `HttpApi.make` | `Route.make` |
| `HttpApiGroup.make` | `Route.group` |
| `HttpApiEndpoint.get` | `Route.get` |
| `HttpApi.addHttpApi` | `Route.addHttpApi` / `api.addHttpApi` |
| `HttpApiClient.urlBuilder` | `Route.urlBuilder` |
| `HttpApi.reflect` | `Route.reflect` |

CamelCase values: `const site = Route.make("site").add(…)`.

Optional destination metadata: `Route.Target` annotation (`kind` / `keys` / `member` / `view`).
Group-built catalogs stamp this so the runtime can read `selected` / `view` from `match`.

## Runtime (`Router`) — service + layers

```ts
const site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.group("app").add(Route.get("dashboard", "/app")),
  Route.addHttpApi(wire),
)

Router.history(site) // Layer — browser
Router.memory(site)  // Layer — tests / TUI / embed

const router = yield* Router.Router
router.to((urls) => urls.app.dashboard())
router.go("/home", { replace: true })
router.pathname
router.match
```

Swap transport by swapping the layer. Catalog stays a plain value (not a Service).

| Method | History effect |
|--------|----------------|
| `go` / `to` / `open*` | **push** (default); `go/to(…, { replace: true })` replaces |
| `up` / `toRoot` | **replace** (tree chrome stays coherent with `back`) |
| `back` | pop memory stack / `history.back()` |

## Group dashboard

Pass a Group to `Router.memory` / `Router.history` — the layer builds the catalog with
the same `Route.make` / `group` / `get` constructors (ordinary loops; not a public
`fromMembers` helper), stamps `Route.Target`, and attaches short-name helpers.

```ts
View.compose({
  views: …,
  router: Router.history(ServicesHub), // or Router.memory(ServicesHub)
})

const router = Router.useRouter()
router.open(HttpApi)           // → /Nwsl/HttpApi (push)
router.up()                    // parent segment (replace)
router.back()                  // previous history entry
router.openHealth()            // via catalog `urls.health()`
```

Group helpers (`open` / `up` / `openLogs` / …) **throw** on a bare `Route.Api` layer —
fail loud, no silent no-ops.

`Navigator` is removed — use `Router`.
