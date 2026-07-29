# UI Route + Router

**Locked (owner 2026-07-29)** · **Navigator cutover Eng’d**

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
router.pathname
router.match
```

Swap transport by swapping the layer. Catalog stays a plain value (not a Service).

## Group dashboard

Pass a Group to `Router.memory` / `Router.history` — the layer builds the catalog with
the same `Route.make` / `group` / `get` constructors (ordinary loops) and attaches
short-name helpers (`open` / `openKey` / `up` / `openLogs` / `openHealth` / …).

```ts
View.compose({
  views: …,
  router: Router.history(ServicesHub), // or Router.memory(ServicesHub)
})

const router = Router.useRouter()
router.open(HttpApi)           // → /Nwsl/HttpApi
router.up()                    // pop one short-name segment
router.back()                  // history / memory stack
```

`Navigator` is removed — use `Router`.
