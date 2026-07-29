# UI Route — HttpApi-shaped public URL router

**Locked (owner 2026-07-29)**

## Shape

| Effect | Route |
|--------|--------|
| `HttpApi.make` | `Route.make` |
| `HttpApiGroup.make` | `Route.Group.make` |
| `HttpApiEndpoint.get` | `Route.get` |
| `HttpApi.addHttpApi` | `Route.addHttpApi` / `api.addHttpApi` |
| `HttpApiClient.urlBuilder` | `Route.urlBuilder` |
| `HttpApi.reflect` | `Route.reflect` |

- **Root endpoints:** `Route.make("site").add(Route.get("docs", "/docs"))` — no `topLevel` needed.
- **`topLevel`:** optional on `Route.Group.make` (HttpApi parity) when a named group should flatten onto the parent builder.
- **Mix wire APIs:** `Route.addHttpApi(wireHttpApi)` imports **URL surface only** (paths / ids / params / group nesting).
- **Runtime:** same constructors in loops — no Group.Tag / `fromMembers` helper in this module.

## Example

```ts
const Wire = HttpApi.make("wire").add(
  HttpApiGroup.make("users", { topLevel: true }).add(
    HttpApiEndpoint.get("getUser", "/users/:id"),
  ),
)

const Site = Route.make("site").add(
  Route.get("home", "/home"),
  Route.Group.make("app").add(Route.get("dashboard", "/app")),
  Route.addHttpApi(Wire),
)

Route.urlBuilder(Site).getUser({ params: { id: "1" } })
Route.match(Site, "/users/1")
```

## Not in scope (yet)

Navigator cutover onto `Route` catalogs (still uses legacy `GroupRoute.resolveGroupRoute`).
