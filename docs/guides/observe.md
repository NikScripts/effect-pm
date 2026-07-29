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

`Bundle.observe(tag)` remains during migration; new code prefers `Observe.use(tag, *View.pack)`.

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

## Packs

```ts
const pack = pipe(
  Observe.struct({ status, trend }),
  Observe.and(queueControls),
  Observe.and(queueMetricsHistory),
)
Observe.named("workpool/queue", pack) // stable memo id
```

## WorkPoolView.pack

`WorkPoolView.pack` is the queue card/detail surface: `status`, `trend`, `metrics`,
`history`, `pause` / `resume` / `clear` / `shutdown`. Status+trend share one fold (same
as today’s `queueBundle`). **Delta:** no `logs` field yet (node-scoped follow-up).

See also [Hyperlink atom](/docs/hyperlink-atom), [Bundles](/docs/bundles) (migration).
