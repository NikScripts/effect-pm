{#dashboard title="Dashboard" status="stable" appliesTo=all}

# Dashboard

Batteries-included Group drill-down for **web** and **TUI**. Point it at a reactive
`Atom.runtime(layer)` and a root `Group`.

```tsx
import { Dashboard } from "hyperlink-ts/web"
// or: import { Dashboard } from "hyperlink-ts/tui"

<Dashboard runtime={Atom.runtime(appLayer)} group={ServicesHub} views={appViews} />
```

## Stack

```text
DashboardLayer.forCompose({ skins, views? })
  → View.compose({ views, navigator })
  → platform DashboardShell
```

| Piece | Import |
|------|--------|
| One-liner | `hyperlink-ts/web` / `hyperlink-ts/tui` → `Dashboard` |
| Layer merge | `hyperlink-ts/ui/DashboardLayer` → `forCompose` |
| Compose kit | `hyperlink-ts/ui` → `View.compose` |
| Shell | `DashboardShell` (same platform package) |
| Observe | `Observe.use(tag, *View.pack)` / `NodeView.use` |

Escape hatch (same stack the one-liner uses):

```tsx
const ui = View.compose({
  views: DashboardLayer.forCompose({
    skins: WebDashboardViews.skins,
    views: appViews,
  }),
  navigator: Navigator.history(ServicesHub),
})
<ui.Provider>
  <RuntimeProvider runtime={runtime}>
    <DashboardShell group={ServicesHub} />
  </RuntimeProvider>
</ui.Provider>
```

Bare `ui.Grid` / `ui.Outlet` stay available but omit Cell / NodeBar / HealthBoard / LogBox.

## Public chrome

Reuse without forking the shell:

| Web | TUI | Role |
|-----|-----|------|
| `DashboardTopBar` | `DashboardTopBar` | Grid title / crumb strip |
| `DashboardDetailChrome` | — | Detail back + title (lock J) |
| `NodeBar` / `HealthBoard` / `NodeDetail` | `NodeMark` | Node status pieces |
| `Navigator.openHealth` / `.openNode` | — | URL pages `/health`, `/health/<nodeId>` |
| `PoolPage` / `DaemonPage` | same | `/…/logs`, `/…/schedule` via `Match.Page` |
| `NodeStatusHost` | — | Overlay stack when no Navigator |

```tsx
// Batteries — die opens /health (History); node card → /health/<nodeId>
nav.openHealth()
nav.openNode(node.id)

// Overlay embed (no Navigator) — hyperlink-ts/web/NodeStatus
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
