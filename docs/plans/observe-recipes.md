# Plan: Observe recipes (pipeable UI packs)

**Status:** design-locked (owner 2026-07-28) — not Eng’d.  
**Branch:** `cursor/view-withsize-types-125f` (Agent G).  
**Prior art:** [`../guides/hyperlink-atom.md`](../guides/hyperlink-atom.md), [`../guides/bundles.md`](../guides/bundles.md), [`../standards/principles.md#handles-stay-thin`](../standards/principles.md#handles-stay-thin), [`../handoffs/view-compose-lock.md`](../handoffs/view-compose-lock.md) §G.

---

## Goal

One **universal** foundation for Effect-reactive UI over Hyperlink Tags:

1. Small recipe combinators (`atom` / `fn` / `query` / `scan` / `struct` / `merge`).
2. Family packs as **pipeable values** (`QueueObserve.live`) — not Tag methods, not a kind-switch door.
3. Bind at the edge (`Observe.bind` / `Observe.use`) under a shared `Atom.AtomRuntime`.

Library Dashboard skins and app code use the **same** stack.

## Non-goals

- View Prototype `.use` for component logic (orthogonal; skins stay render-only for now).
- Putting observe weight on `Jobs` / any Tag.
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
| Same stack for lib + apps | Private dashboard-only observe path |

---

## Modules

| Path | Import | Role |
|------|--------|------|
| `src/Observe.ts` | `import * as Observe from "hyperlink-ts/Observe"` | Public recipes + bind |
| `src/internal/observe.ts` | — | Engine (name mirror) |
| `src/ui/QueueObserve.ts` | `import * as QueueObserve from "hyperlink-ts/ui/QueueObserve"` | Queue pack values |
| later | `DaemonObserve`, `GateObserve`, … | Same pattern per family |

`package.json` exports + tsup entry for `./Observe` and `./ui/QueueObserve`.

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

## Family packs

`src/ui/QueueObserve.ts` exports camelCase values only (`live`, maybe `controls`, `metricsHistory` as building blocks).

Shared pieces used by queue + priority:

```ts
export const controls = Observe.struct({ … pause/resume/clear/shutdown … })
export const metricsHistory = Observe.struct({ … metrics + history scan … })
export const live = pipe(
  Observe.struct({ status, trend }),
  Observe.and(controls),
  Observe.and(metricsHistory),
  // logs: Observe.and(logs) when node-bound helper lands
)
```

Daemon / Gate / Api follow the same file-per-family pattern.

---

## Migration from Bundles

| Phase | Work |
|-------|------|
| **0** | Eng `Observe` + `QueueObserve.live`; tests; guide |
| **1** | Dogfood one web `QueueCard` / `QueueDetailPanel` on `Observe.use(QueueObserve.live, tag)` |
| **2** | Rewrite `queueBundle` as thin wrapper over `Observe.bind` (or delete once call sites moved) |
| **3** | Port priority / daemon / gate / api packs; delete `Bundle.observe` kind switch |
| **4** | Remove deprecated `use*Bundle` / `ui.data` after in-tree greps are clean |

`Bundle.observe` stays until Phase 3 so nothing breaks mid-flight. Changeset: **minor** (new module); later **minor** for Bundle soft-remove / deprecate.

---

## Acceptance

1. `QueueObserve.live` is a camelCase module value; Tag has no observe API.  
2. `Observe.use(QueueObserve.live, Jobs)` works under `RuntimeProvider`.  
3. `Observe.bind(rt)(QueueObserve.live, Jobs)` works without React.  
4. History/trend scans + cache behavior match today’s `queueBundle` (or documented deltas).  
5. Web queue card dogfood uses only Observe + QueueObserve (no `Bundle.observe`).  
6. Typecheck + Observe/QueueObserve tests green; guide under `docs/guides/observe.md`.

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

### 2. Queue pack (`QueueObserve.live`)

```ts
/**
 * @module ui/QueueObserve
 */
import { DateTime, pipe } from "effect"
import * as Observe from "hyperlink-ts/Observe"
import type { QueueMetrics, QueueStatus } from "hyperlink-ts/ui" // or WorkPool schemas

/** Structural queue service — select against this, not a concrete Tag class. */
type Queue = {
  readonly status: { readonly changes: Stream.Stream<QueueStatus> } // Subscribable
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

export const controls = Observe.struct({
  pause: Observe.fn((q: Queue) => q.pause),
  resume: Observe.fn((q: Queue) => q.resume),
  clear: Observe.fn((q: Queue) => q.clear),
  shutdown: Observe.fn((q: Queue) => q.shutdown),
})

export const metricsHistory = Observe.struct({
  metrics: Observe.atom((q: Queue) => q.metrics.stream),
  history: Observe.scan((q: Queue) => q.metrics.stream, {
    map: toMetricPoint,
    cap: 1800,
    cacheKey: (tag) => `${tag.key}/history`,
    seed: (q) => q.metrics.query({ limit: 1800 }),
  }),
})

/**
 * Full queue UI pack — every queue card/detail imports this value.
 */
export const live = pipe(
  Observe.struct({
    status: Observe.atom((q: Queue) => q.status),
    trend: Observe.scan((q: Queue) => q.status, {
      map: pendingOf,
      cap: 60,
      cacheKey: (tag) => `${tag.key}/trend`,
    }),
  }),
  Observe.and(controls),
  Observe.and(metricsHistory),
)
```

### 3. Wire runtime (app edge)

```ts
import { Atom } from "effect/unstable/reactivity"
import { Layer } from "effect"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Jobs } from "./Jobs"

const appLayer = Hyperlink.client(Jobs) // or local WorkPool.layer(Jobs, …)
export const runtime = Atom.runtime(appLayer)
```

### 4. React skins (library or app — same code)

```tsx
import * as React from "react"
import { AsyncResult } from "effect/unstable/reactivity"
import { Option } from "effect"
import * as Observe from "hyperlink-ts/Observe"
import * as QueueObserve from "hyperlink-ts/ui/QueueObserve"
import { RuntimeProvider, useAtomValue, useAtomSet } from "hyperlink-ts/ui"
import { Jobs } from "./Jobs"
import { runtime } from "./runtime"

export function JobsCard(): React.ReactElement {
  const box = Observe.use(QueueObserve.live, Jobs)
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
  const box = Observe.use(QueueObserve.live, Jobs)
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
import * as QueueObserve from "hyperlink-ts/ui/QueueObserve"
import { Jobs } from "./Jobs"
import { runtime } from "./runtime"

const box = Observe.bind(runtime)(QueueObserve.live, Jobs)
const registry = AtomRegistry.make()
registry.mount(box.status)

const read = () => {
  const r = registry.get(box.status)
  return AsyncResult.isSuccess(r) ? r.value : undefined
}
```

### 6. Custom HyperService (no family pack)

```ts
import * as Observe from "hyperlink-ts/Observe"

const counterLive = Observe.struct({
  count: Observe.atom((c: { readonly count: Subscribable<number> }) => c.count),
  bump: Observe.fn((c: { readonly bump: Effect.Effect<void> }) => c.bump),
})

const box = Observe.use(counterLive, Counter)
```

No registration in a kind menu — import the pack you composed.

---

## Open Eng details (resolve while implementing)

1. **Deduped dual-projection** — today one status stream feeds `status` + `trend`. `Observe.scan` + `Observe.atom` on the same select should share a channel (extend `channelKeyOf` / pack-local share).  
2. **Logs** — node-scoped log stream needs `nodeOf(tag)`; either `Observe.logsFromNode` helper or a small `QueueObserve.withLogs` pipe stage.  
3. **`Observe.use` vs hooks rules** — `use` must call `useRuntime()` unconditionally (same as today’s Bundle).  
4. **Fold vs keep `Hyperlink.atom`** — recommend keep both: Hyperlink = one-field bind; Observe = recipes + packs.

---

## Docs / changeset

- Guide: `docs/guides/observe.md` (stack diagram; link from bundles as migration).  
- Update `principles.md` example: `Observe.use(QueueObserve.live, Jobs)`.  
- Changeset **minor** on Eng of `Observe` + `QueueObserve`.  
- Lock note in `view-compose-lock.md` §G when Phase 0 lands.
