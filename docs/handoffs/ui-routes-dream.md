# UI Routes — dream API (HttpApi-shaped)

**Branch:** `cursor/view-withsize-types-125f`  
**State:** declaration + match + urlBuilder **Eng’d**; Navigator cutover **not** yet.

## Invariants

1. **One toolkit** — apps and kit use the same `Route` / `Routes` builders.
2. **`fromGroup` is a feature** of that toolkit, not private Navigator walk math.
3. **String paths** at the public edge (`/Nwsl/HttpApi`, `/health/:nodeId`). Segment arrays stay internal if needed.
4. **Not HttpApi runtime** — we do **not** drive nav via `HttpApiClient.make` / `HttpRouter`. Inspiration only; location stays ours.

## Modules

| Module | HttpApi analogue | Role |
|--------|------------------|------|
| `hyperlink-ts/ui/Route` | `HttpApiEndpoint` | id + path + params (+ annotations) |
| `hyperlink-ts/ui/Routes` | `HttpApi` + `HttpApiGroup` | catalog, groups, `fromGroup`, `match`, `urlBuilder` |

**UI extension:** groups may carry a `path` (layout / navigable nest). HttpApi groups are not path-bearing; we need this so `urls.Nwsl()` and `fromGroup` share one shape.

## Dream usage

```ts
const Dashboard = Routes.make("dashboard").add(
  Routes.group("shell", { topLevel: true }).add(
    Route.make("health", "/health"),
    Route.make("node", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    ),
  ),
  Routes.fromGroup(ServicesHub, { leafViews: ["logs", "schedule"] }),
)

const urls = Routes.urlBuilder(Dashboard)
urls.health()
urls.Nwsl.HttpApi.logs()

Routes.match(Dashboard, location.pathname)
```

## Next (Navigator)

Thin Navigator to: bind `memory` / `history` + subscribe over a `Routes` catalog (derived client / `go`). Retire hard-coded `openHealth` / path arrays from the public `Service` once skins migrate.
