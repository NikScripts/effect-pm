# Storage model (mandatory)

**Target:** `ProcessStore` is a **layer combiner only**. Storage facets live under **`src/store/`**
with **`@nikscripts/effect-pm/store/*`** subpaths. See [STORAGE-AGENT-HANDBOOK.md](./STORAGE-AGENT-HANDBOOK.md).

**Transitional:** Legacy `ProcessStore` monolith until Part P. Facets are in `src/store/` (camelCase filenames).

---

## Layout

```
src/store/
  queueResource.ts
  groupLog.ts
  runtime.ts
  processLifecycle.ts
src/internal/store/
  spine.ts, codec.ts, composite.ts   ← internal only
```

**Subpath** (import): `@nikscripts/effect-pm/store/QueueResource` — **not** the worker `@nikscripts/effect-pm/QueueResource`.

**Context key** (deterministic): `@nikscripts/effect-pm/store/queueResource/ProcessStoreQueueResource` — matches file path.

---

## Public facets

| Service tag | Subpath | File |
|-------------|---------|------|
| `ProcessStoreRuntime` | `store/Runtime` | `src/store/runtime.ts` |
| `ProcessStoreQueueResource` | `store/QueueResource` | `src/store/queueResource.ts` |
| `ProcessStoreGroupLog` | `store/GroupLog` | `src/store/groupLog.ts` |
| `ProcessStoreProcessLifecycle` | `store/ProcessLifecycle` | `src/store/processLifecycle.ts` |
| `RuntimeStorage` | `RuntimeStorage` | row port (not a store facet) |
| `ProcessStore` | `ProcessStore` | combiner + legacy monolith (Part P) |

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
import { ProcessStoreRuntime } from "@nikscripts/effect-pm/store/Runtime";
import { ProcessStoreQueueResource } from "@nikscripts/effect-pm/store/QueueResource";

const runtime = yield* ProcessStoreRuntime;
yield* runtime.facts(query);

const qr = yield* Effect.serviceOption(ProcessStoreQueueResource);
if (Option.isSome(qr)) {
  yield* qr.value.withQueue("my-queue", qr.value.entryEnqueued({ key: "job-1" }));
}
```

Facet namespace exports **`layerRuntimeStorage` + `layer` only** — no static `Effect.flatMap` wrappers.

Capture/relay: **`@nikscripts/effect-pm/Logs`**. See [ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).

---

## Do not

- Put facet tags in `internal/store/` (spine/composite only).
- Use `@nikscripts/effect-pm/ProcessStoreQueueResource` top-level subpaths — use **`store/*`**.
- Confuse **`store/QueueResource`** (storage facet) with **`QueueResource`** (worker module).
- Add namespace wrappers or extend `ProcessStoreInterface`.
