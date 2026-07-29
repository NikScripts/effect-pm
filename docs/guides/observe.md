{#observe title="Observe recipes" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/observe>.
<!-- docs-site-link:end -->
# Observe recipes

Unbound Effect-reactive **recipes** and **packs**, discharged with `Observe.bind` /
`Observe.use`. Family packs live on service `*View` modules (e.g. `WorkPoolView.pack`).

```ts
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
import { RuntimeProvider, useAtomValue } from "hyperlink-ts/ui"

// React (under RuntimeProvider)
const box = Observe.use(Jobs, WorkPoolView.pack)
const status = useAtomValue(box.status)

// Non-React
const box2 = Observe.bind(runtime)(Jobs, WorkPoolView.pack)
```

## Stack

| Layer | API | Role |
|-------|-----|------|
| Handle | `yield* Jobs` | Universal Effect / Stream / ref surface |
| Atom adapters | `Hyperlink.atom` / `.query` / `.fn` | One-field bind (already attached to `rt`) |
| Recipes | `Observe.atom` / `.fn` / `.scan` / `.fold` | Unbound selectors |
| Packs | `WorkPoolView.pack` | Shipped UI field sets on `*View` |
| Discharge | `Observe.bind` / `.use` | Tag + pack → atom box |

`Bundle.observe`, `use*Bundle`, and `View.compose().data` are removed — see [Bundles](/docs/bundles).

## Recipes

| Constructor | Binds to |
|-------------|----------|
| `Observe.atom(select)` | Subscribable / Stream → `Atom<AsyncResult>` |
| `Observe.query(select)` | Effect read → `Atom<AsyncResult>` |
| `Observe.fn(select)` | Command → `AtomResultFn` |
| `Observe.scan(select, { map, cap, cacheKey?, seed?, cache? })` | Capped history array |
| `Observe.fold(select, { initial, step, tap?, seed?, channel? })` | Custom accumulator (shared parent for `map`) |
| `Observe.poll(select, every)` | Spaced Effect poll |
| `Observe.map(recipe, f)` | Project success value (shares upstream bind) |
| `Observe.recipe(bind)` | Escape hatch for custom bind logic |
| `Observe.packOf(id, bind)` | Named pack over an existing builder (parity bridge) |

## Packs

```ts
const pack = pipe(
  Observe.struct({ status, trend }),
  Observe.and(queueControls),
  Observe.and(queueMetricsHistory),
  Observe.and(queueLogs),
)
Observe.named("workpool/queue", pack) // stable memo id
```

### Shipped family packs

| Pack | Import | Surface |
|------|--------|---------|
| Queue | `WorkPoolView.pack` | status, trend, metrics, history, controls, logs |
| Priority | `PriorityView.pack` | status, trend, metrics, history, start, logs |
| Daemon | `DaemonView.pack` | status, schedule, controls, logs |
| API | `ApiMetricsView.pack` | metrics / history |
| Gate | `GateView.pack` | gate status / controls |
| Fleet | `FleetHealthView.pack` | fleet health |
| Telemetry | `TelemetryView.pack` | telemetry |
| Shard map | `ShardMapView.pack` | shard map |
| Node | `NodeView.bind` / `.use(ref)` | status / logs / health (`NodeRef`, not a Tag) |

Call site shape is always **tag then pack**:

```ts
Observe.use(Jobs, WorkPoolView.pack)
Observe.use(Nightly, DaemonView.pack)
NodeView.use(ref)
```

## Compositional packs

All shipped `*View.pack` values are `Observe` recipes (not kind-switch builders):

- **Queue / Priority** — shared folds for status+trend and metrics+history; controls + `serviceLogs`
- **Daemon** — status atom, polled schedule, controls, logs
- **API** — usage atoms + window history fold
- **Gate** — status atom
- **FleetHealth / Telemetry / ShardMap** — `Observe.poll` every 2s with projected fields
- **Node** — `NodeView.bind` / `.use` (NodeRef is not a Tag; not `Observe.use`)

`WorkPoolView` also exports slices (`queueControls`, `queueMetricsHistory`, `serviceLogs`) for thinner packs.

Runnable pack demo: [`examples/observe/pack-demo.ts`](../../examples/observe/pack-demo.ts) ·
`pnpm run example:observe-pack-demo` · [Examples hub](/docs/examples#observe).

See also [Hyperlink atom](/docs/hyperlink-atom), [Bundles](/docs/bundles) (retirement map).
