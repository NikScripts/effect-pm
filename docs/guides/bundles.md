{#bundles title="Bundles (retired)" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/bundles>.
<!-- docs-site-link:end -->
# Bundles (retired)

`Bundle.observe` / `Bundle.node`, `use*Bundle`, and `View.compose().data` are **removed**.

Use [Observe](/docs/observe):

```ts
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
import * as NodeView from "hyperlink-ts/ui/NodeView"

const box = Observe.use(Jobs, WorkPoolView.pack)
const node = NodeView.use(ref)
```

| Was | Now |
|-----|-----|
| `Bundle.observe(queueTag)` | `Observe.use(tag, WorkPoolView.pack)` |
| `Bundle.observe(priorityTag)` | `Observe.use(tag, PriorityView.pack)` |
| `Bundle.observe(daemonTag)` | `Observe.use(tag, DaemonView.pack)` |
| `Bundle.observe(apiTag)` | `Observe.use(tag, ApiMetricsView.pack)` |
| `Bundle.observe(gateTag)` | `Observe.use(tag, GateView.pack)` |
| `Bundle.observe(fleetTag)` | `Observe.use(tag, FleetHealthView.pack)` |
| `Bundle.observe(telemetryTag)` | `Observe.use(tag, TelemetryView.pack)` |
| `Bundle.observe(shardTag)` | `Observe.use(tag, ShardMapView.pack)` |
| `Bundle.node(ref)` | `NodeView.use(ref)` |
| `ui.data.queue(tag)` / `useQueueBundle` | `Observe.use(tag, WorkPoolView.pack)` |

Atom box shapes (`QueueBundle`, `DaemonBundle`, …) remain as TypeScript types in `hyperlink-ts/ui`
for widget props; they are not a public observe door.
