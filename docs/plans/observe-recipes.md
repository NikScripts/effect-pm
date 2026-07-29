# Plan: Observe recipes (pipeable UI packs)

**Status:** design-locked (owner 2026-07-28; pack home 2026-07-29) — not Eng’d.  
**Pack namespace name:** **open** — `Live` rejected (worse than `Bundle`). Plan still uses `Bundle.*` as a working label only.  
**Branch:** `cursor/view-withsize-types-125f` (Agent G).  
**Prior art:** [`../guides/hyperlink-atom.md`](../guides/hyperlink-atom.md), [`../guides/bundles.md`](../guides/bundles.md), [`../standards/principles.md#handles-stay-thin`](../standards/principles.md#handles-stay-thin), [`../handoffs/view-compose-lock.md`](../handoffs/view-compose-lock.md) §G.

---

## Goal

One **universal** foundation for Effect-reactive UI over Hyperlink Tags:

1. Small recipe combinators (`atom` / `fn` / `query` / `scan` / `struct` / `merge`).
2. Family packs as **pipeable values on a shared `Bundle` namespace** (`Bundle.queue`, `Bundle.daemon`, …) — not Tag methods, not a kind-switch door, not per-family `*Observe` modules.
3. Bind at the edge (`Observe.bind` / `Observe.use`) under a shared `Atom.AtomRuntime`.

Library Dashboard skins and app code use the **same** stack.

## Pack home (locked)

| Option | Verdict |
|--------|---------|
| `WorkPool.live` / packs on domain modules | **No** — packs carry UI concerns (localStorage history, trend caps). Domain modules (`WorkPool`, `Daemon`, `Gate`) stay wire/engine clean. |
| Per-family `QueueObserve` modules | **No** — fragments the former Bundle surface. |
| **Shared `Bundle` namespace** (`hyperlink-ts/ui/Bundle`) | **Yes** — one home for all former packs: `Bundle.queue`, `Bundle.priority`, `Bundle.daemon`, `Bundle.api`, … |

`Bundle.observe(tag)` kind-dispatch **retires**. Call site becomes `Observe.use(Bundle.queue, Jobs)`.

## Non-goals

- View Prototype `.use` for component logic (orthogonal; skins stay render-only for now).
- Putting observe weight on `Jobs` / any Tag, or UI packs on `WorkPool` / `Daemon`.
- A forever `Bundle.observe(tag)` kind menu (retire after migration).
- TanStack / Promise hosts (still `Hyperlink.promise` + parallel adapters).
- Un-HOLD kit `<Dashboard />` (shell stays product chrome).

## Law

| Must | Must not |
|------|----------|
| Handles stay thin | `Jobs.observe()` / kit noun menus |
| Composition over inheritance | Bundle base classes |
| File = namespace, flat exports | `export const Observe = { … }` |
| Values camelCase | `QueueLive` as a value name |
| UI packs under `ui/Bundle` | Packs on domain `WorkPool` / `Daemon` |
| Same stack for lib + apps | Private dashboard-only observe path |

---

## Modules

| Path | Import | Role |
|------|--------|------|
| `src/Observe.ts` | `import * as Observe from "hyperlink-ts/Observe"` | Universal recipes + bind / use |
| `src/internal/observe.ts` | — | Engine (name mirror) |
| `src/ui/Bundle.ts` | `import * as Bundle from "hyperlink-ts/ui/Bundle"` | All family **pack values** (`queue`, `daemon`, …) |
| `src/internal/bundleQueue.ts` (etc.) | — | Heavy pack pipes (optional split); re-exported flat from `Bundle.ts` |

`package.json` / tsup: `./Observe` (new); `./ui/Bundle` already exists.

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
  pack: Pack<Svc, Out>,
  tag: Effect<Svc, never, R> & { readonly key: string },
) => Out

/** React — reads RuntimeProvider; same memo as bind. */
Observe.use<Svc, Out>(
  pack: Pack<Svc, Out>,
  tag: Effect<Svc, never, unknown> & { readonly key: string },
): Out
```

Memo key: `(runtime, tag.key, packIdentity)`. Pack identity = stable module const (reference equality), or an optional `Observe.named("queue/live", pack)` for HMR-safe keys.

### Types (`export declare namespace Observe`)

```ts
export declare namespace Observe {
  export type Recipe<Svc, Out>
  export type Pack<Svc, Out>
  export type BoundOf<R> = R extends Recipe<infer _S, infer Out> ? Out : never
}
```

---

## Family packs (`Bundle`)

Flat camelCase exports on `src/ui/Bundle.ts` (heavy pipes may live in `src/internal/bundle*.ts`):

| Export | Replaces |
|--------|----------|
| `Bundle.queue` | `queueBundle` / `QueueBundle` door |
| `Bundle.priority` | `priorityBundle` |
| `Bundle.daemon` | `daemonBundle` |
| `Bundle.api` | `apiBundle` |
| `Bundle.gate` | `gateBundle` |
| `Bundle.fleetHealth` | `fleetHealthBundle` |
| `Bundle.telemetry` | `telemetryBundle` |
| `Bundle.shardMap` | `shardMapBundle` |
| `Bundle.node` | pack for `NodeRef` (or keep as bind helper) |

Shared queue/priority pieces (also on `Bundle`, or internal-only):

```ts
export const queueControls = Observe.struct({ /* pause/resume/clear/shutdown */ })
export const queueMetricsHistory = Observe.struct({ /* metrics + history scan */ })
export const queue = pipe(
  Observe.struct({ status, trend }),
  Observe.and(queueControls),
  Observe.and(queueMetricsHistory),
)
```

---

## Migration from Bundles

| Phase | Work |
|-------|------|
| **0** | Eng `Observe` + `Bundle.queue` pack value; tests; guide |
| **1** | Dogfood one web `QueueCard` / `QueueDetailPanel` on `Observe.use(Bundle.queue, tag)` |
| **2** | Rewrite `queueBundle` as thin wrapper over `Observe.bind(Bundle.queue, …)` (or delete) |
| **3** | Port remaining packs onto `Bundle.*`; delete `Bundle.observe` kind switch |
| **4** | Remove deprecated `use*Bundle` / `ui.data` after in-tree greps are clean |

`Bundle.observe` stays until Phase 3 so nothing breaks mid-flight. Changeset: **minor** (`Observe` + pack reshape).

---

## Acceptance

1. `Bundle.queue` is a camelCase pack value on `ui/Bundle`; Tag / `WorkPool` have no observe API.  
2. `Observe.use(Bundle.queue, Jobs)` works under `RuntimeProvider`.  
3. `Observe.bind(rt)(Bundle.queue, Jobs)` works without React.  
4. History/trend scans + cache behavior match today’s `queueBundle` (or documented deltas).  
5. Web queue card dogfood uses only `Observe` + `Bundle.queue` (no kind-switch `Bundle.observe`).  
6. Typecheck + Observe/Bundle pack tests green; guide under `docs/guides/observe.md`.

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

### 2. Queue pack on shared `Bundle`

```ts
/**
 * @module ui/Bundle
 *
 * Former family packs as pipeable values — not a kind-switch door.
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
export const queue = pipe(
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

// later on the same module: priority, daemon, api, gate, …
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
import * as Bundle from "hyperlink-ts/ui/Bundle"
import { RuntimeProvider, useAtomValue, useAtomSet } from "hyperlink-ts/ui"
import { Jobs } from "./Jobs"
import { runtime } from "./runtime"

export function JobsCard(): React.ReactElement {
  const box = Observe.use(Bundle.queue, Jobs)
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
  const box = Observe.use(Bundle.queue, Jobs)
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
import * as Bundle from "hyperlink-ts/ui/Bundle"
import { Jobs } from "./Jobs"
import { runtime } from "./runtime"

const box = Observe.bind(runtime)(Bundle.queue, Jobs)
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

const counterLive = Observe.struct({
  count: Observe.atom((c: { readonly count: Subscribable<number> }) => c.count),
  bump: Observe.fn((c: { readonly bump: Effect.Effect<void> }) => c.bump),
})

const box = Observe.use(counterLive, Counter)
```

Compose with `Observe.*`; optionally contribute a pack to `Bundle` later — no kind menu.

---

## Open questions

### Blocking Eng Phase 0 — pack namespace name

`Live` rejected. Need the noun for the shared UI pack module:

```ts
Observe.use(???.queue, Jobs)
```

Locked shape (not renaming): not on Tag / not on domain / not per-family `*Observe` / not a kind-switch `*.observe`. Combinators stay on **`Observe`**; this NS is **only shipped packs**.

### Open Eng details (resolve while implementing)

1. **Deduped dual-projection** — today one status stream feeds `status` + `trend`. `Observe.scan` + `Observe.atom` on the same select should share a channel (extend `channelKeyOf` / pack-local share).  
2. **Logs** — node-scoped log stream needs `nodeOf(tag)`; `Observe` helper or pack pipe stage.  
3. **`Observe.use` vs hooks rules** — `use` must call `useRuntime()` unconditionally.  
4. **Fold vs keep `Hyperlink.atom`** — keep both: Hyperlink = one-field bind; Observe = recipes; pack NS = shipped packs.

---

## Docs / changeset

- Guide: `docs/guides/observe.md` (stack diagram; bundles guide becomes migration → `Bundle.queue`).  
- Update `principles.md` example: `Observe.use(Bundle.queue, Jobs)`.  
- Changeset **minor** on Eng of `Observe` + `Bundle.queue` packs.  
- Lock note in `view-compose-lock.md` §G when Phase 0 lands.
