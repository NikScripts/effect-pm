# Plan: Observe recipes (pipeable UI packs)

**Status:** Phases 0–4 Eng’d — Observe + all family `*View.pack` + web/TUI dogfood; `Bundle` / `use*Bundle` / `View.compose().data` **removed**.  
**Branch:** `cursor/view-withsize-types-125f` (Agent G).  
**Prior art:** [`../guides/hyperlink-atom.md`](../guides/hyperlink-atom.md), [`../guides/bundles.md`](../guides/bundles.md), [`../guides/observe.md`](../guides/observe.md), [`../standards/principles.md#handles-stay-thin`](../standards/principles.md#handles-stay-thin), [`../handoffs/view-compose-lock.md`](../handoffs/view-compose-lock.md) §G.

---

## Goal

One **universal** foundation for Effect-reactive UI over Hyperlink Tags:

1. Small recipe combinators (`atom` / `fn` / `query` / `scan` / `struct` / `merge`) on **`Observe`**.
2. Family packs as **pipeable values on the matching service `*View` module** (`WorkPoolView.pack`, `DaemonView.pack`, …) — same modules that already own card/detail Tags + contribution Layers.
3. Bind at the edge (`Observe.bind` / `Observe.use`) under a shared `Atom.AtomRuntime`.

Library Dashboard skins and app code use the **same** stack.

## Pack home (locked)

| Option | Verdict |
|--------|---------|
| Domain `WorkPool` / `Daemon` / … | **No** — packs carry UI concerns (localStorage history, trend caps). Domain stays wire/engine clean. |
| Shared pack NS (`Bundle` / `Live` / `Pack` / `Family`) | **No** — `Live` rejected; `Family` was a **name** veto, not a placement veto; no second noun for “all packs”. |
| Orphan `*Observe` modules | **No** — don’t invent a parallel tree next to `*View`. |
| **Service `ui/*View` modules** | **Yes** — packs sit beside View handles + `layer` on the module apps already import for that service. |

`Bundle.observe(tag)` kind-dispatch **retires**. Call site:

```ts
Observe.use(Jobs, WorkPoolView.pack)
Observe.use(MyDaemon, DaemonView.pack)
```

### Mapping (today’s Bundle → `*View`)

| Today | Pack home | Export |
|-------|-----------|--------|
| `queueBundle` / `Bundle.observe(queueTag)` | `ui/WorkPoolView` | `WorkPoolView.pack` |
| `priorityBundle` | `ui/PriorityView` | `PriorityView.pack` |
| `daemonBundle` | `ui/DaemonView` | `DaemonView.pack` |
| `apiBundle` | `ui/ApiMetricsView` | `ApiMetricsView.pack` |
| `gateBundle` | `ui/GateView` | `GateView.pack` |
| `fleetHealthBundle` | `ui/FleetHealthView` | `FleetHealthView.pack` |
| `telemetryBundle` | `ui/TelemetryView` | `TelemetryView.pack` |
| `shardMapBundle` | `ui/ShardMapView` | `ShardMapView.pack` |
| `nodeStatusBundle` / `Bundle.node` | `ui/NodeView` | `NodeView.use` / `.bind` (NodeRef, not a Tag) |

Convention: each service `*View` exports one primary observe pack as **`pack`** (camelCase value). Shared sub-pipes (`queueControls`, history scans) are additional flat exports on the same module when useful, or `internal/` only.

## Non-goals

- View Prototype `.use` for component logic (orthogonal; skins stay render-only for now).
- Putting observe weight on `Jobs` / any Tag, or UI packs on domain `WorkPool` / `Daemon`.
- A forever `Bundle.observe(tag)` kind menu (retire after migration).
- A shared `Bundle` / `Live` / `Pack` / `Family` namespace whose only job is holding packs.
- TanStack / Promise hosts (still `Hyperlink.promise` + parallel adapters).
- Kit `<Dashboard />` unheld separately (see [`view-compose-lock.md`](../handoffs/view-compose-lock.md) K2).

## Law

| Must | Must not |
|------|----------|
| Handles stay thin | `Jobs.observe()` / kit noun menus |
| Composition over inheritance | Bundle / View base classes for packs |
| File = namespace, flat exports | `export const Observe = { … }` |
| Values camelCase (`pack`) | `QueueLive` as a value name |
| Packs on matching `ui/*View` | Packs on domain `WorkPool` / `Daemon` |
| Same stack for lib + apps | Private dashboard-only observe path |
| Tag then pack (`use(Jobs, pack)`) | Pack then tag — match `Hyperlink.atom(rt)(Jobs, select)` |

---

## Modules

| Path | Import | Role |
|------|--------|------|
| `src/Observe.ts` | `import * as Observe from "hyperlink-ts/Observe"` | Universal recipes + bind / use |
| `src/internal/observe.ts` | — | Engine (name mirror) |
| `src/ui/WorkPoolView.ts` (etc.) | `import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"` | View handles + `layer` + **`pack`** (and sub-pipes) |
| `src/internal/workPoolViewPack.ts` (optional) | — | Heavy pack pipes; re-exported flat from `*View.ts` |
| ~~`src/ui/Bundle.ts`~~ | — | **Removed** (Phase 4) |

`package.json` / tsup: `./Observe` (new); `./ui/*View` already exist.

**Relationship to `Hyperlink.atom` / `.query` / `.fn`:** keep those as the low-level “already bound to `rt`” adapters. `Observe.*` recipes are **unbound**; `Observe.bind(rt)` / `Observe.use` discharge them (internally may call `Hyperlink.atom` / `.fn`). No duplicate semantics.

---

## Public API (`Observe`)

### Recipe constructors (unbound)

```ts
Observe.atom<Svc, A>(select: (svc: Svc) => Subscribable<A> | Stream<A>): Recipe<Svc, Atom<AsyncResult<A>>>
Observe.query<Svc, A>(select: (svc: Svc) => Effect<A>): Recipe<Svc, Atom<AsyncResult<A>>>
Observe.fn<Svc, Arg, A>(select: (svc: Svc) => Effect<A> | ((arg: Arg) => Effect<A>)): Recipe<Svc, AtomResultFn<Arg, A>>
Observe.scan<Svc, I, A>(
  select: (svc: Svc) => Stream<I>,
  options: {
    readonly map: (item: I) => A
    readonly cap: number
    readonly cacheKey?: (tag: { readonly key: string }) => string
    /** Optional one-shot seed before the live stream. */
    readonly seed?: (svc: Svc) => Effect<ReadonlyArray<I>>
  },
): Recipe<Svc, Atom<AsyncResult<ReadonlyArray<A>>>>
Observe.poll<Svc, A>(
  select: (svc: Svc) => Effect<A>,
  every: Duration.Input,
): Recipe<Svc, Atom<AsyncResult<A>>>
```

### Packs

```ts
Observe.struct<Svc, Fields extends Record<string, Recipe<Svc, unknown>>>(
  fields: Fields,
): Pack<Svc, { readonly [K in keyof Fields]: BoundOf<Fields[K]> }>

Observe.merge<Svc, A extends Record<string, unknown>, B extends Record<string, unknown>>(
  left: Pack<Svc, A>,
  right: Pack<Svc, B>,
): Pack<Svc, A & B>
// pipe-friendly:
Observe.and<Svc, B>(right: Pack<Svc, B>): <A>(left: Pack<Svc, A>) => Pack<Svc, A & B>
```

### Bind

```ts
Observe.bind(runtime: Atom.AtomRuntime<R, ER>): <Svc, Out>(
  tag: Effect<Svc, never, R> & { readonly key: string },
  pack: Pack<Svc, Out>,
) => Out

/** React — reads RuntimeProvider; same memo as bind. */
Observe.use<Svc, Out>(
  tag: Effect<Svc, never, unknown> & { readonly key: string },
  pack: Pack<Svc, Out>,
): Out
```

Memo key: `(runtime, tag.key, packIdentity)`. Pack identity = stable module const (reference equality), or an optional `Observe.named("workpool/pack", pack)` for HMR-safe keys.

### Types (`export declare namespace Observe`)

```ts
export declare namespace Observe {
  export type Recipe<Svc, Out>
  export type Pack<Svc, Out>
  export type BoundOf<R> = R extends Recipe<infer _S, infer Out> ? Out : never
}
```

---

## Packs on `*View`

Example shape on `WorkPoolView` (heavy pipe may live in `internal/workPoolViewPack.ts`):

```ts
export const queueControls = Observe.struct({ /* pause/resume/clear/shutdown */ })
export const queueMetricsHistory = Observe.struct({ /* metrics + history scan */ })
export const pack = pipe(
  Observe.struct({ status, trend }),
  Observe.and(queueControls),
  Observe.and(queueMetricsHistory),
)
```

Same pattern on `DaemonView`, `GateView`, … — each exports **`pack`**.

---

## Migration from Bundles

| Phase | Work | State |
|-------|------|-------|
| **0** | Eng `Observe` + `WorkPoolView.pack`; tests; guide | **Eng’d** |
| **1** | Dogfood web/TUI skins on `Observe.use(tag, *View.pack)` / `NodeView.use` | **Eng’d** |
| **2** | Rewrite `queueBundle` as thin wrap over `WorkPoolView.pack` | **Eng’d** |
| **3** | Port remaining packs onto matching `*View.pack`; `Bundle.*` → deprecated shim | **Eng’d** |
| **4** | Remove deprecated `use*Bundle` / `ui.data` / `ui/Bundle` after greps are clean | **Eng’d** |

Changeset: **minor** (`Observe` + pack reshape + `*View` subpaths).

---

## Acceptance

1. `WorkPoolView.pack` is a camelCase pack value on `ui/WorkPoolView`; Tag / domain `WorkPool` have no observe API.  
2. `Observe.use(Jobs, WorkPoolView.pack)` works under `RuntimeProvider`.  
3. `Observe.bind(rt)(Jobs, WorkPoolView.pack)` works without React.  
4. History/trend scans + cache behavior match today’s `queueBundle` (or documented deltas).  
5. Web queue card dogfood uses only `Observe` + `WorkPoolView.pack` (no kind-switch `Bundle.observe`).  
6. Typecheck + Observe / WorkPoolView pack tests green; guide under `docs/guides/observe.md`.

---

## Full example

End-to-end: Tag → pack → React card + detail. Types sketched to match WorkPool queue control shape.

### 1. App Tag (unchanged — thin)

```ts
import { Schema } from "effect"
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Node from "hyperlink-ts/Node"

const Job = Schema.Struct({ id: Schema.String })

class Edge extends Node.Tag<Edge>()("app/Edge", {
  url: "http://127.0.0.1:3443/rpc",
  kind: "WebSocket",
}) {}

export class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job,
  node: Edge,
}) {}
```

### 2. Queue pack on `WorkPoolView`

```ts
/**
 * @module ui/WorkPoolView
 *
 * View handles + contribution Layer + observe pack.
 */
import { DateTime, pipe, type Effect, type Stream } from "effect"
import * as Observe from "hyperlink-ts/Observe"
import type { QueueMetrics, QueueStatus } from "./data"

/** Structural queue service — select against this, not a concrete Tag class. */
type Queue = {
  readonly status: { readonly get: Effect.Effect<QueueStatus>; readonly changes: Stream.Stream<QueueStatus> }
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<QueueMetrics>>
  }
  readonly pause: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
  readonly clear: Effect.Effect<void>
  readonly shutdown: Effect.Effect<void>
}

const toMetricPoint = (m: QueueMetrics) => ({
  t: DateTime.toEpochMillis(m.windowEnd),
  throughput: m.throughputPerSec,
  latency: m.avgTotalMillis ?? 0,
})

const pendingOf = (s: QueueStatus) => s.sizes.high + s.sizes.normal + s.sizes.low

export const queueControls = Observe.struct({
  pause: Observe.fn((q: Queue) => q.pause),
  resume: Observe.fn((q: Queue) => q.resume),
  clear: Observe.fn((q: Queue) => q.clear),
  shutdown: Observe.fn((q: Queue) => q.shutdown),
})

export const queueMetricsHistory = Observe.struct({
  metrics: Observe.atom((q: Queue) => q.metrics.stream),
  history: Observe.scan((q: Queue) => q.metrics.stream, {
    map: toMetricPoint,
    cap: 1800,
    cacheKey: (tag) => `${tag.key}/history`,
    seed: (q) => q.metrics.query({ limit: 1800 }),
  }),
})

/** Full queue UI pack — every queue card/detail uses this value. */
export const pack = pipe(
  Observe.struct({
    status: Observe.atom((q: Queue) => q.status),
    trend: Observe.scan((q: Queue) => q.status, {
      map: pendingOf,
      cap: 60,
      cacheKey: (tag) => `${tag.key}/trend`,
    }),
  }),
  Observe.and(queueControls),
  Observe.and(queueMetricsHistory),
)
```

### 3. Wire runtime (app edge)

```ts
import { Atom } from "effect/unstable/reactivity"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Jobs } from "./Jobs"

const appLayer = Hyperlink.client(Jobs) // or local WorkPool.layer(Jobs, …)
export const runtime = Atom.runtime(appLayer)
```

### 4. React skins (library or app — same code)

```tsx
import * as React from "react"
import { AsyncResult } from "effect/unstable/reactivity"
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
import { RuntimeProvider, useAtomValue, useAtomSet } from "hyperlink-ts/ui"
import { Jobs } from "./Jobs"
import { runtime } from "./runtime"

export function JobsCard(): React.ReactElement {
  const box = Observe.use(Jobs, WorkPoolView.pack)
  const statusR = useAtomValue(box.status)
  const pause = useAtomSet(box.pause)
  const s = AsyncResult.isSuccess(statusR) ? statusR.value : undefined
  const pending =
    s === undefined ? 0 : s.sizes.high + s.sizes.normal + s.sizes.low

  return (
    <button type="button" onClick={() => pause()}>
      <strong>Jobs</strong>
      <span>{pending} pending</span>
      <span>{s?.phase ?? "…"}</span>
    </button>
  )
}

export function JobsDetail(): React.ReactElement {
  const box = Observe.use(Jobs, WorkPoolView.pack)
  const historyR = useAtomValue(box.history)
  const points = AsyncResult.isSuccess(historyR) ? historyR.value : []
  const resume = useAtomSet(box.resume)

  return (
    <section>
      <h1>Jobs</h1>
      <button type="button" onClick={() => resume()}>resume</button>
      <pre>{JSON.stringify(points.slice(-20), null, 2)}</pre>
    </section>
  )
}

export function App(): React.ReactElement {
  return (
    <RuntimeProvider runtime={runtime}>
      <JobsCard />
      <JobsDetail />
    </RuntimeProvider>
  )
}
```

### 5. Non-React (tests / scripts)

```ts
import { AtomRegistry, AsyncResult } from "effect/unstable/reactivity"
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
import { Jobs } from "./Jobs"
import { runtime } from "./runtime"

const box = Observe.bind(runtime)(Jobs, WorkPoolView.pack)
const registry = AtomRegistry.make()
registry.mount(box.status)

const read = () => {
  const r = registry.get(box.status)
  return AsyncResult.isSuccess(r) ? r.value : undefined
}
```

### 6. Custom HyperService (no shipped pack)

```ts
import * as Observe from "hyperlink-ts/Observe"

const counterPack = Observe.struct({
  count: Observe.atom((c: { readonly count: Subscribable<number> }) => c.count),
  bump: Observe.fn((c: { readonly bump: Effect.Effect<void> }) => c.bump),
})

const box = Observe.use(Counter, counterPack)
```

Compose with `Observe.*`; optionally add `pack` on a matching `*View` later — no kind menu.

---

## Open Eng details

None for Observe. Kit Dashboard unhold / chrome peel lives in [`view-compose-lock.md`](../handoffs/view-compose-lock.md) K2.

Resolved: shared fold via `Observe.map`; all family `*View.pack`s compositional (queue/priority/daemon/api/gate + polled fleet packs); `Observe.use` always calls `useRuntime()`; Phase 4 Bundle/`use*Bundle`/`data` removed; builders in `ui/data` are thin wraps; **NodeView** atom construction lives in `ui/nodeViewPack` (`NodeView.bind` / `.use`; `nodeStatusBundle` is a thin wrap — NodeRef is not a Tag).

---

## Docs / changeset

- Guide: `docs/guides/observe.md` (stack + family table).  
- Bundles guide → migration pointer.  
- `principles.md`: `Observe.use(Jobs, WorkPoolView.pack)`.  
- Changeset **minor** for `Observe` + packs + `*View` / `NodeView` subpaths.
