{#dashboard-compose title="Dashboard compose" status="stable" appliesTo=all}

# Dashboard compose

How the batteries `<Dashboard>` is assembled from Router + GroupNav + View.
For browser transport (WebSocket) and the one-liner, see [Dashboard](/docs/dashboard).
For catalogs and navigation, see [Routing](/docs/routing).

```tsx
import { Dashboard } from "hyperlink-ts/web"
// or: import { Dashboard } from "hyperlink-ts/tui"

<Dashboard runtime={Atom.runtime(appLayer)} group={ServicesHub} views={appViews} />
```

## Stack

```text
Layer.mergeAll(DashboardLayer.layer, appViews?).pipe(
  DashboardLayer.provide(WebDashboardViews.provides),
)
  → View.compose({ views, router, group })
  → platform DashboardShell
```

| Piece | Import |
|------|--------|
| One-liner | `hyperlink-ts/web` / `hyperlink-ts/tui` → `Dashboard` |
| Contributions | `DashboardLayer.layer` |
| Implementations | `*.provides` → `DashboardLayer.provide` |
| Ready platform Layer | `WebDashboardViews.layer` / `TuiDashboardViews.layer` |
| Compose kit | `hyperlink-ts/ui` → `View.compose` |
| Shell | `DashboardShell` (same platform package) |
| Observe | `Observe.use(tag, *View.pack)` / `NodeView.use` |

Escape hatch (same stack the one-liner uses):

```tsx
const site = Route.make("dashboard").add(
  Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
)
const views = Layer.mergeAll(DashboardLayer.layer, appViews).pipe(
  DashboardLayer.provide(WebDashboardViews.provides),
)
const ui = View.compose({
  views,
  router: Router.history(site),
  group: ServicesHub,
})
<ui.Provider>
  <RuntimeProvider runtime={runtime}>
    <DashboardShell group={ServicesHub} />
  </RuntimeProvider>
</ui.Provider>
```

Bare `ui.Grid` / `ui.Outlet` stay available but omit Cell / NodeBar / HealthBoard / LogBox.

## Targets and pages

`Group.asRoutes` stamps a tagged `Route.TargetValue` on each destination
(`Group` / `Leaf` / `LeafView` / `Health`). View provides read path segments with
`Route.viewOf` (`"logs"` / `"schedule"` / `"health"` — lowercase URL referents)
and leaf selection with `Route.memberOf`. Live engine is `router._tag`
(`"Memory"` / `"History"` / `"Waku"`) — not a separate mode field.

## Public chrome

Reuse without forking the shell:

| Web | TUI | Role |
|-----|-----|------|
| `DashboardTopBar` | `DashboardTopBar` | Grid title / crumb strip |
| `DashboardDetailChrome` | — | Detail back + title (lock J) |
| `NodeBar` / `HealthBoard` / `NodeDetail` | `NodeMark` | Node status pieces |
| `GroupNav.openHealth` / `.openNode` | — | URL pages `/health`, `/health/<nodeId>` |
| `PoolPage` / `DaemonPage` | same | `/…/logs`, `/…/schedule` via `Match.Page` |
| `NodeStatusHost` | — | Overlay stack when no Router |

```tsx
// Batteries: die opens /health (History); node card → /health/<nodeId>
const groupNav = GroupNav.use(ServicesHub)
groupNav.openHealth()
groupNav.openNode(node.id)

// Overlay embed (no Router) — hyperlink-ts/web/NodeStatus
import { NodeBar, NodeStatusHost, DashboardTopBar } from "hyperlink-ts/web"

<NodeStatusHost group={ServicesHub}>
  {({ openHealth }) => (
    <DashboardTopBar
      title="Hub"
      trailing={<NodeBar group={ServicesHub} onOpen={openHealth} />}
    />
  )}
</NodeStatusHost>
```

## App views

```ts
export const layer = View.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(View.provide(WorkerPoolCard, WorkerPoolCardView)),
)

<Dashboard runtime={runtime} group={ServicesHub} views={layer} />
```

See [View tag types](/docs/view-tag-types), [Observe](/docs/observe), compose lock
[`view-compose-lock.md`](../handoffs/view-compose-lock.md).
