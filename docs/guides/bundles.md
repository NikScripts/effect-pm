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
import { RuntimeProvider, useAtomValue } from "hyperlink-ts/ui"
import * as Bundle from "hyperlink-ts/ui/Bundle"

function JobsCard({ tag }: { tag: typeof Jobs }) {
  const box = Bundle.observe(tag)
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
| Bundle | `Bundle.observe(Jobs)` | Family UI pack (charts, cache, commands) on the atom path |

`Bundle.observe` is a free helper (thin Tags). It is not a method on the Tag or on `View.compose`.

## What it is

| Piece | Role |
|-------|------|
| **Value atoms** | Live reads (`status`, `metrics`, `logs`, …) via `useAtomValue` |
| **Command atoms** | Writes (`pause`, `resume`, `start`, …) as `Atom` result-fns |

Builders memoize one Bundle per `(runtime, tag.key)`. Straight status/command fields use
`Hyperlink.atom` / `Hyperlink.fn`; history/trend/logs/schedule scans stay Bundle-owned.

## Families

| Kind | Bundle |
|------|--------|
| WorkPool queue | `QueueBundle` |
| WorkPool priority | `PriorityBundle` |
| Daemon | `DaemonBundle` |
| HttpApi / API metrics | `ApiBundle` |
| Fleet health | `FleetHealthBundle` |
| Telemetry | `TelemetryBundle` |
| Shard map | `ShardMapBundle` |
| Gate | `GateBundle` |
| Node | `Bundle.node(ref)` → `NodeBundle` |

Wrong kind fails loudly.

## Door

Call during render under `RuntimeProvider`:

```ts
import * as Bundle from "hyperlink-ts/ui/Bundle"

Bundle.observe(Jobs)     // QueueBundle
Bundle.observe(Nightly)  // DaemonBundle
Bundle.node(ref)         // NodeBundle
Bundle.runtime()         // Atom.AtomRuntime
```

**One public door:** `Bundle.observe` / `Bundle.node`.  
`use*Bundle` and `View.compose(…).data.*` are **deprecated** aliases (same builders; removal later).

Same stack for library Dashboard and app code: `Hyperlink.atom/fn` → Bundle builders →
`Bundle.observe` under `RuntimeProvider`. View Prototype `use` for component logic is **not**
the observe door (future / optional); Bundles stay the family UI pack.

## Custom HyperServices

1. Spec + Tag + layer/client (Handle for free).
2. For thin UI: `Hyperlink.atom(rt)(MyTag, (s) => s.field)` under `RuntimeProvider`.
3. For a Dashboard-style pack: write a `*Bundle` builder (see `src/ui/data.ts`) and wire a kind into `Bundle.observe` (or call your builder directly until registered).
