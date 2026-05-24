# Storage model (mandatory)

**Target (in progress):** `ProcessStore` is a **layer combiner only** — not a `Context.Service` with `append`. Facets (`ProcessStoreGroupLog`, `ProcessStoreQueueResource`, `ProcessStoreRuntime`, …) are separate tags with `layerRuntimeStorage`. See [**STORAGE-AGENT-HANDBOOK.md**](./STORAGE-AGENT-HANDBOOK.md) “Target architecture”. The sections below describe the **transitional** codebase until Part P lands.

**One persistence stack. Facets are separate context services with their own layers.**

## Layers

| Layer | Role |
|-------|------|
| **`RuntimeStorage`** | Raw port over normalized `RuntimeRecord` rows. |
| **`ProcessStore`** | Core client: `append`, `events`, `records`, runtime projections. |
| **`ProcessStoreGroupLog`** | Structured `group.log.entry` persistence (`record`, `load`, `query`). |
| **`ProcessStoreQueueResource`** | Queue semantic runtime facts (entry lifecycle, dedupe keys, queries). |

```ts
import { ProcessStore } from "@nikscripts/effect-pm/ProcessStore";
import { ProcessStoreGroupLog } from "@nikscripts/effect-pm/ProcessStoreGroupLog";
import { ProcessStoreQueueResource } from "@nikscripts/effect-pm/ProcessStoreQueueResource";
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";

// Full stack (core + both facets, one RuntimeStorage):
const storeLayer = layerProcessStore({ filename: ".effect-pm/data.sqlite" });
// equivalent to ProcessStore.layerRuntimeStorage + sqlite RuntimeStorage

// Slim apps — provide only what you need:
ProcessStoreQueueResource.layerRuntimeStorage; // queue analytics only
ProcessStoreGroupLog.layerRuntimeStorage; // group log persistence only
```

SQLite stays on `@nikscripts/effect-pm/storage/sqlite` so the core `ProcessStore` bundle does not pull in `@effect/sql-sqlite-node`.

## Usage

Facet helpers require the matching context tag (or the composite `ProcessStore.layer` / `layerProcessStore`, which provides all three):

```ts
yield* ProcessStoreGroupLog.record("my-group", "1", entry);
yield* ProcessStoreGroupLog.load({ groupId: "my-group", limit: 100, sort: "desc" });

yield* ProcessStoreQueueResource.withQueue("email-queue", …);
```

When you already have the composite store, instance facets remain on `ProcessStoreInterface`:

```ts
const { GroupLog, QueueResource } = yield* ProcessStore;
yield* GroupLog.load({ … });
```

Domain modules (`QueueResource`, log relay) use `Effect.serviceOption(ProcessStoreQueueResource)` / `ProcessStoreGroupLog` — not the full `ProcessStore` tag — so they stay lightweight when only a facet layer is provided.

Capture and live tail (group child, `pm watch`) use **`@nikscripts/effect-pm/Logs`** (`captureLoggerLayer`, `relayLayer`). Durable history uses **`ProcessStoreGroupLog`**. See [ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).

## Do not

- Add storage `Layer`s on domain modules.
- Use `ProcessStore.file` / `storage/file` for new code.
- Put `relayLayer` or `captureLoggerLayer` on `ProcessStore` (use `Logs` subpath only).
- Re-add static `ProcessStore.GroupLog` / `ProcessStore.QueueResource` namespace boilerplate; use the facet service tags.
