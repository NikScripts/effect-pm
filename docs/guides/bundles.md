{#bundles title="Bundles" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/bundles>.
<!-- docs-site-link:end -->
# Bundles

> **Migration:** prefer [Observe](/docs/observe) — `Observe.use(tag, *View.pack)` /
> `NodeView.use(ref)`. `Bundle.observe` / `Bundle.node` remain deprecated shims.

A **Bundle** is the UI observe/control surface for one Hyperlink Tag (or node): a small
object of Effect atoms derived from that tag under a shared `Atom.AtomRuntime`. Skins and
panels read and steer through that surface. They do not open a second channel beside the Tag.

```tsx
import { RuntimeProvider, useAtomValue } from "hyperlink-ts/ui"
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"

function JobsCard({ tag }: { tag: typeof Jobs }) {
  const box = Observe.use(tag, WorkPoolView.pack)
  const status = useAtomValue(box.status)
  return <pre>{JSON.stringify(status)}</pre>
}

// tree must wrap RuntimeProvider (Dashboard does; compose apps wrap themselves)
```

## Stack

| Layer | API | Role |
|-------|-----|------|
| Handle | `yield* Jobs` | Universal Effect / Stream / ref surface |
| Promise | `Hyperlink.promise(handle)` | OS edge for non-Effect hosts |
| Atom adapters | `Hyperlink.atom` / `.query` / `.fn` | Universal Effect-reactive bindings |
| Observe | `Observe.use(Jobs, WorkPoolView.pack)` | Unbound recipes + `*View.pack` ([Observe](/docs/observe)) |
| Bundle | `Bundle.observe(Jobs)` | Deprecated kind-dispatch shim → same packs |

## What it is

| Piece | Role |
|-------|------|
| **Value atoms** | Live reads (`status`, `metrics`, `logs`, …) via `useAtomValue` |
| **Command atoms** | Writes (`pause`, `resume`, `start`, …) as `Atom` result-fns |

Builders / packs memoize one box per `(runtime, tag.key, pack id)`.

## Families → packs

| Kind | Prefer | Deprecated |
|------|--------|------------|
| WorkPool queue | `Observe.use(tag, WorkPoolView.pack)` | `Bundle.observe(tag)` |
| WorkPool priority | `Observe.use(tag, PriorityView.pack)` | `Bundle.observe(tag)` |
| Daemon | `Observe.use(tag, DaemonView.pack)` | `Bundle.observe(tag)` |
| HttpApi / API metrics | `Observe.use(tag, ApiMetricsView.pack)` | `Bundle.observe(tag)` |
| Fleet health | `Observe.use(tag, FleetHealthView.pack)` | `Bundle.observe(tag)` |
| Telemetry | `Observe.use(tag, TelemetryView.pack)` | `Bundle.observe(tag)` |
| Shard map | `Observe.use(tag, ShardMapView.pack)` | `Bundle.observe(tag)` |
| Gate | `Observe.use(tag, GateView.pack)` | `Bundle.observe(tag)` |
| Node | `NodeView.use(ref)` | `Bundle.node(ref)` |

Wrong kind still fails loudly on the shim.

## Custom HyperServices

1. Spec + Tag + layer/client (Handle for free).
2. For thin UI: `Hyperlink.atom(rt)(MyTag, (s) => s.field)` under `RuntimeProvider`.
3. For a Dashboard-style pack: compose `Observe.struct` / `Observe.and` (see [Observe](/docs/observe)), optionally export `pack` from a matching `*View` module.
