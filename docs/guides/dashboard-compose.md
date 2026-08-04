{#dashboard-compose title="Dashboard compose" status="stable" appliesTo=all}

# Dashboard compose

How the batteries `<Dashboard>` is assembled from Router + GroupNav + `Views`.
DI components stay on `View` (`last-ts/View` / `hyperlink-ts/ui/View`).
For browser transport (WebSocket) and the one-liner, see [Dashboard](/docs/dashboard).
For catalogs and navigation, see [Routing](/docs/routing).

```tsx
import { Dashboard } from "hyperlink-ts/web"
// or: import { Dashboard } from "hyperlink-ts/tui"

<Dashboard runtime={Atom.runtime(appLayer)} group={ServicesHub} views={appViews} />
```

## Stack

```text
Layer.mergeAll(DashboardViews.layer, appViews?).pipe(
  Layer.provideMerge(Dashboard.componentsLayer),
  Layer.provideMerge(Views.base),
)
  → Views.compose({ views, router, group })
  → platform DashboardShell
```

| Piece | Import |
|------|--------|
| One-liner | `hyperlink-ts/web` / `hyperlink-ts/tui` → `Dashboard` |
| Contributions | `import * as DashboardViews from "hyperlink-ts/ui/DashboardViews"` |
| Platform | `import * as Dashboard from "hyperlink-ts/web\|tui/Dashboard"` (`componentsLayer` / `layer`) |
| Compose kit | `import * as Views from "hyperlink-ts/ui/Views"` → `Views.compose` |
| DI | `import * as View from "last-ts/View"` → `View.Service` + `Layer.succeed` |
| Shell | `DashboardShell` (same platform package) |
| Observe | `Observe.use(tag, *View.pack)` / `NodeView.use` |

Escape hatch (same stack the one-liner uses):

```tsx
import * as Views from "hyperlink-ts/ui/Views"
const site = Route.make("dashboard").add(
  Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
)
import * as Dashboard from "hyperlink-ts/web/Dashboard"
const views = Layer.mergeAll(DashboardViews.layer, appViews).pipe(
  Layer.provideMerge(Dashboard.componentsLayer),
  Layer.provideMerge(Views.base),
)
const ui = Views.compose({
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
import * as View from "last-ts/View"
import * as Views from "hyperlink-ts/ui/Views"

export const layer = Views.only(WorkerPool, WorkerPoolCard).pipe(
  Layer.provide(Layer.succeed(WorkerPoolCard, WorkerPoolCardView)),
)

<Dashboard runtime={runtime} group={ServicesHub} views={layer} />
```

See [View tag types](/docs/view-tag-types), [Observe](/docs/observe), compose lock
[`view-compose-lock.md`](../handoffs/view-compose-lock.md).
