{#bundles title="Bundles" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/bundles>.
<!-- docs-site-link:end -->
# Bundles

A **Bundle** is the UI observe/control surface for one Hyperlink Tag (or node): a small
object of Effect atoms derived from that tag under a shared `Atom.AtomRuntime`. Skins and
panels read and steer through the Bundle. They do not open a second channel beside the Tag.

```tsx
import { RuntimeProvider, useAtomValue, useQueueBundle } from "hyperlink-ts/ui"

function JobsCard({ tag }: { tag: typeof Jobs }) {
  const box = useQueueBundle(tag)
  const status = useAtomValue(box.status)
  return <pre>{JSON.stringify(status)}</pre>
}

// tree must wrap RuntimeProvider (Dashboard does; compose apps wrap themselves)
```

## What it is

The Tag is the contract (`yield* Jobs` in Effect). The Bundle is that same service projected
into reactive UI:

| Piece | Role |
|-------|------|
| **Value atoms** | Live reads (`status`, `metrics`, `logs`, …) as `Atom` results you subscribe with `useAtomValue` |
| **Command atoms** | Writes (`pause`, `resume`, `start`, …) as `Atom` result-fns the UI can fire |

Builders (`queueBundle`, `daemonBundle`, …) memoize one Bundle per `(runtime, tag.key)`.
Re-render does not re-subscribe the wire.

## What it is not

- Not a parallel store. Atoms wrap the Tag’s streams, refs, and effects.
- Not navigation. `Navigator` owns open/back/path; the Bundle owns observe/control.
- Not chrome. `View` owns Card/Detail/Page skins and compose; Bundles feed those skins.

## Families

Each stamped Hyperlink kind has a Bundle shape in `hyperlink-ts/ui` (`src/ui/data.ts`):

| Kind | Bundle | Typical fields |
|------|--------|----------------|
| WorkPool queue | `QueueBundle` | `status`, `metrics`, `history`, `trend`, `logs`, `pause` / `resume` / `clear` / `shutdown` |
| WorkPool priority | `PriorityBundle` | queue fields + `start` |
| Daemon | `DaemonBundle` | `status`, `logs`, `schedule`, `start` / `stop` / `run`, schedule commands |
| HttpApi / API metrics | `ApiBundle` | `status`, `metrics`, `history`, rate-limit fields |
| Fleet health | `FleetHealthBundle` | `byNode`, `status` |
| Telemetry | `TelemetryBundle` | `metricCount`, `inFlightByNode`, `fleetInFlight`, `metrics` |
| Shard map | `ShardMapBundle` | `size`, `sizeByNode`, `sizeLocal` |
| Gate | `GateBundle` | `status` |
| Node | `NodeBundle` | `id`, `status`, `logs`, `health` |

Wrong kind at a typed door fails loudly (predicate on the tag’s stamped kind).

## Door

Call during render under `RuntimeProvider`. Preferred public namespace (thin handles, free
helper; see [Handles stay thin](/docs/principles#handles-stay-thin)):

```ts
import * as Bundle from "hyperlink-ts/ui/Bundle"

const box = Bundle.observe(Jobs) // → QueueBundle
```

Until that namespace lands, the same builders ship as:

| Call | Returns |
|------|---------|
| `useQueueBundle(tag)` | `QueueBundle` |
| `usePriorityBundle(tag)` | `PriorityBundle` |
| `useDaemonBundle(tag)` | `DaemonBundle` |
| `useApiBundle(tag)` | `ApiBundle` |
| `useFleetHealthBundle(tag)` | `FleetHealthBundle` |
| `useTelemetryBundle(tag)` | `TelemetryBundle` |
| `useShardMapBundle(tag)` | `ShardMapBundle` |
| `useGateBundle(tag)` | `GateBundle` |
| `useNodeBundle(ref)` | `NodeBundle` |
| `queueBundle(runtime, tag)` (etc.) | same, when you already hold the runtime |

`View.compose(…).data.*` is an interim kit noun menu. Prefer the helpers above, then
`Bundle.observe` once it ships. Do not hang observe on the Tag or on the compose kit.
