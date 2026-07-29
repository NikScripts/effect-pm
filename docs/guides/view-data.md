{#view-data title="View compose data" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/view-data>.
<!-- docs-site-link:end -->
# View compose data

`ui.data` is the **data door** on `View.compose`: the same `*Bundle(runtime, tag)`
builders Dashboard widgets already use. No parallel atoms. Runtime stays outside compose
(`RuntimeProvider`).

## Shape

```tsx
import { Atom } from "effect/unstable/reactivity"
import { View, RuntimeProvider, useAtomValue } from "hyperlink-ts/ui"
import * as Navigator from "hyperlink-ts/ui/Navigator"

const ui = View.compose({
  views: readyLayer,                 // R = never
  navigator: Navigator.history(Hub), // or .memory for tests / TUI
})

function JobsPanel() {
  const bundle = ui.data.queue(Jobs)
  const status = useAtomValue(bundle.status)
  return <pre>{JSON.stringify(status)}</pre>
}

export function App({ runtime }: { runtime: ReturnType<typeof Atom.runtime> }) {
  return (
    <RuntimeProvider runtime={runtime}>
      <ui.Provider>
        <ui.Grid />
        <ui.Outlet />
        <JobsPanel />
      </ui.Provider>
    </RuntimeProvider>
  )
}
```

## API

| Call | Returns |
|------|---------|
| `ui.data.queue(tag)` | `QueueBundle` |
| `ui.data.priority(tag)` | `PriorityBundle` |
| `ui.data.daemon(tag)` | `DaemonBundle` |
| `ui.data.api(tag)` | `ApiBundle` |
| `ui.data.fleetHealth(tag)` | `FleetHealthBundle` |
| `ui.data.telemetry(tag)` | `TelemetryBundle` |
| `ui.data.shardMap(tag)` | `ShardMapBundle` |
| `ui.data.gate(tag)` | `GateBundle` |
| `ui.data.node(ref)` | `NodeBundle` |
| `ui.data.runtime()` | `Atom.AtomRuntime` |

Wrong kind → throws (`View.data.queue: tag … is not a queue tag`).

## Rules

1. **Hook** — call during render (uses React context).
2. **Provider** — must be under `RuntimeProvider` (Dashboard sets this up; compose apps wrap themselves).
3. **Shared context** — web and TUI use the same `ui/runtime` provider, so one door works in both shells.
4. **Navigation ≠ data** — `Navigator` owns open/back/path; `ui.data` owns observe/control atoms.

## vs Dashboard hooks

`useQueueBundle` / `useDaemonBundle` / … are the same functions (`ui.data.queue` etc.).
Compose apps can use either; prefer `ui.data.*` when you already hold the compose kit.
