# UI Route — dream API (HttpApi-shaped)

**Branch:** `cursor/view-withsize-types-125f`  
**State:** `Route` toolkit + `groupRoute.routes` **Eng’d**; Navigator cutover **not** yet.

## Invariants

1. **One toolkit namespace:** `hyperlink-ts/ui/Route` — destinations, nests, app, match, urlBuilder.
2. **Group → routes is a bridge**, not a Route primitive — `groupRoute.routes(hub)` (same file family as Group path resolve). It only calls `Route.group` / `Route.make` / `.add`.
3. **String paths** at the public edge. Segment arrays stay on legacy Navigator until cutover.
4. **Not HttpApi runtime** — no `HttpApiClient.make` / `HttpRouter` for UI nav.

## How dynamic routes work

`groupRoute.routes(ServicesHub, { leafViews: ["logs", "schedule"] })` walks the Group tree:

| Member | Emitted with Route builders |
|--------|-----------------------------|
| nested Group `Nwsl` | `Route.group("Nwsl", { path: "/Nwsl" }).add(…children)` |
| leaf `HttpApi` | `Route.group("HttpApi", { path: "/Nwsl/HttpApi" })` |
| leaf view | `Route.make("logs", "/Nwsl/HttpApi/logs")` on that nest |

Each node is annotated with `Member` (and `LeafView` for sub-views) so `Route.match` can recover the tag. Equivalent hand-written tree is bit-identical for paths (see tests).

```text
Hub
└─ Nwsl          →  /Nwsl
   └─ HttpApi    →  /Nwsl/HttpApi
      ├─ logs    →  /Nwsl/HttpApi/logs
      └─ schedule→  /Nwsl/HttpApi/schedule
```

## Modules

| Surface | Role |
|---------|------|
| `ui/Route` | `make` / `group` / `app` / `match` / `urlBuilder` |
| `ui/groupRoute.routes` | Group tree → `Route.Group` |

## Usage

```ts
const Dashboard = Route.app("dashboard").add(
  routes(ServicesHub, { leafViews: ["logs", "schedule"] }),
  Route.group("shell", { topLevel: true }).add(
    Route.make("health", "/health"),
    Route.make("node", "/health/:nodeId").pipe(
      Route.params(Schema.Struct({ nodeId: Schema.String })),
    ),
  ),
)

const urls = Route.urlBuilder(Dashboard)
urls.Nwsl.HttpApi.logs()
Route.match(Dashboard, location.pathname)
```

## Next

Thin Navigator over `Route.app` + location; retire public path arrays / hard-coded `openHealth`.
