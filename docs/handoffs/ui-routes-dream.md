# UI Route + Router

**Locked (owner 2026-07-29)**

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

## Not yet

Navigator cutover onto `Router` (dashboard still uses `Navigator` + Group path resolve).
