# Storage model (mandatory)

**Target:** `ProcessStore` is a **layer combiner only**. Storage facets live under **`src/store/`**
with **`@nikscripts/effect-pm/store/*`** subpaths. See [STORAGE-AGENT-HANDBOOK.md](./STORAGE-AGENT-HANDBOOK.md)
and [STORAGE-FACET-AUTHORING-GUIDE.md](./STORAGE-FACET-AUTHORING-GUIDE.md).

**One facet per domain.** Each domain owns concrete fact / state / query types and its own wire event types — no shared generic envelope appears in any facet's public API.

**Transitional:** Legacy `ProcessStore` monolith until Part P. Facets are in `src/store/` (camelCase filenames).

---

## Layout

```
src/store/
  queueResource.ts
  groupLog.ts
  runResource.ts
  processLifecycle.ts
src/internal/store/
  spine.ts, codec.ts, composite.ts   ← internal only
  factEnvelope.ts                    ← internal-only generic envelope still used by QueueResource
```

**Subpath** (import): `@nikscripts/effect-pm/store/QueueResource` — **not** the worker `@nikscripts/effect-pm/QueueResource`.

**Context key** (deterministic): `@nikscripts/effect-pm/store/queueResource/ProcessStoreQueueResource` — matches file path.

---

## Public facets

| Service tag | Subpath | File |
|-------------|---------|------|
| `ProcessStoreRunResource` | `store/RunResource` | `src/store/runResource.ts` |
| `ProcessStoreQueueResource` | `store/QueueResource` | `src/store/queueResource.ts` |
| `ProcessStoreGroupLog` | `store/GroupLog` | `src/store/groupLog.ts` |
| `ProcessStoreProcessLifecycle` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` |
| `RuntimeStorage` | `RuntimeStorage` | row port (not a store facet) |
| `ProcessStore` | `ProcessStore` | combiner + legacy monolith (Part P) |

> The previous `ProcessStoreRuntime` facet (`@nikscripts/effect-pm/store/Runtime`) was a **generic shared sink** for runtime facts and has been renamed and re-scoped to `ProcessStoreRunResource`, tailored specifically for the `RunResource` concurrency gate. The generic `RuntimeFact` / `RuntimeRef` / `RuntimeStateChange` / `RuntimeStateBase` vocabulary is no longer part of the public API. Other domains (process executions, schedules, …) that need similar observation must publish their **own** concrete event types via their own facets — see [STORAGE-FACET-AUTHORING-GUIDE.md](./STORAGE-FACET-AUTHORING-GUIDE.md).

---

## Layers

```ts
import { Layer } from "effect";
import { ProcessStoreQueueResource } from "@nikscripts/effect-pm/store/QueueResource";
import { layerRuntimeStorage } from "@nikscripts/effect-pm/storage/sqlite";

// Queue analytics only
const queueOnly = Layer.provide(
  ProcessStoreQueueResource.layerRuntimeStorage,
  layerRuntimeStorage({ filename: ".effect-pm/queue.sqlite" }),
);

// Full stack
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";
const allFacets = layerProcessStore({ filename: ".effect-pm/data.sqlite" });
```

---

## Usage

```ts
import { ProcessStoreRunResource } from "@nikscripts/effect-pm/store/RunResource";
import { ProcessStoreQueueResource } from "@nikscripts/effect-pm/store/QueueResource";

const runs = yield* ProcessStoreRunResource;
yield* runs.facts({ resourceId: "@app/FetchPrices" });
yield* runs.runs("@app/FetchPrices");

const qr = yield* Effect.serviceOption(ProcessStoreQueueResource);
if (Option.isSome(qr)) {
  yield* qr.value.withQueue("my-queue", qr.value.entryEnqueued({ key: "job-1" }));
}
```

Facet namespace exports **`layerRuntimeStorage` + `layer` only** — no static `Effect.flatMap` wrappers.

Capture/relay: **`@nikscripts/effect-pm/Logs`**. See [ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).

---

## Optional emit pattern

`ProcessStoreRunResource` exposes **static** per-type shortcuts on the tag itself —
`recordRunStarted`, `recordRunCompleted`, `recordRunFailed`, `recordStateChange`
(plus `recordFactBatch` / `recordStateChangeBatch`). Domain modules (e.g. `RunResource`) call them directly:

```ts
yield* ProcessStoreRunResource.recordRunStarted(fact)
```

When the facet layer is absent the call is a silent no-op; when present, the spine persists the event. Failures are isolated by the builder's built-in `catchCause + logWarning` wrap on every static emitter (logged, never propagated to the caller).

Reads still require composing the layer:

```ts
const runs = yield* ProcessStoreRunResource
yield* runs.facts({ resourceId })
yield* runs.runs(resourceId)          // paired started + ended history
yield* runs.byRun(runId)              // facts for one specific run
yield* runs.stateHistory({ resourceId })
yield* runs.latestState(resourceId)
```

For in-process observation (no persistence), provide a custom service whose shape matches `ProcessStoreRunResource.Type` via `Effect.provideService` / `Layer.succeed`. There is **no** package-level `layerListeners` helper on any facet. A planned future feature — `ProcessStoreRunResource.live(resourceId): Stream<...>` — will replace the custom-service pattern with a proper subscription stream.

---

## Do not

- Reach for `RuntimeFact`, `RuntimeRef`, `RuntimeStateChange`, or `RuntimeStateBase` from any public API. They have been moved to `src/internal/store/factEnvelope.ts` as internal envelope plumbing for `ProcessStoreQueueResource` only. New facets must own concrete domain-typed shapes.
- Use the wire event types `runtime.fact.recorded` / `runtime.state.changed` in your facet's writes — those are the internal envelope wire types used by `ProcessStoreQueueResource`'s persistence layer only. Pick `<my-domain>.fact.recorded` / `<my-domain>.state.changed` for new facets.
- Add a `layerListeners` or any second fake `ProcessStoreRunResource` API on the facet — provide a custom service typed as `ProcessStoreRunResource.Type` via `Effect.provideService` instead (the in-process listener fan-out is documented in `RunResource`'s module doc and in `examples/forms/resource/run-resource-runtime-observer.ts`).
- Put facet tags in `internal/store/` (spine/composite/envelope only).
- Use `@nikscripts/effect-pm/ProcessStoreQueueResource` top-level subpaths — use **`store/*`**.
- Confuse **`store/QueueResource`** (storage facet) with **`QueueResource`** (worker module).
- Add namespace wrappers or extend `ProcessStoreInterface`.
