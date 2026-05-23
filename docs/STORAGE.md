# Storage model (mandatory)

**One persistence stack. No parallel storage APIs on domain modules.**

## Layers

| Layer | Role |
|-------|------|
| **`RuntimeStorage`** | Raw port over normalized `RuntimeRecord` rows. Swap adapters: memory, SQLite (`@nikscripts/effect-pm/storage/sqlite`), Prisma (future). |
| **`ProcessStore`** | Client API: `append`, `events`, `records`, and **facets** `Logs` / `QueueStore`. |

```ts
import { Layer } from "effect";
import { ProcessStore } from "@nikscripts/effect-pm/ProcessStore";
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";

// Durable local (pulls in @effect/sql-sqlite-node only when you import this subpath):
const storeLayer = layerProcessStore({ filename: ".effect-pm/data.sqlite" });

// In-memory tests:
const memoryLayer = ProcessStore.layer;
```

`ProcessStore` core entry **does not** import SQLite. Use `layerProcessStore` from `@nikscripts/effect-pm/storage/sqlite`.

## Store facets

After `const store = yield* ProcessStore` (or destructure):

```ts
const { Logs, QueueStore } = yield* ProcessStore;

yield* Logs.record("my-group", "1", entry);
yield* Logs.query({ groupId: "my-group", limit: 100, sort: "desc" });

yield* QueueStore.withQueue("email-queue", QueueStore.entryEnqueued({ key: "x" }));
```

`@nikscripts/effect-pm/Logs` and `@nikscripts/effect-pm/QueueStore` re-export the same APIs via `Effect.flatMap(ProcessStore, …)` when you want top-level helpers without destructuring.

## Do not

- Add `Logs.layer`, `QueueStore.layer`, or other storage composition under domain modules.
- Use `ProcessStore.file` / `storage/file` for new code.
- Duplicate the `ProcessStore.QueueResource` namespace — use `store.QueueStore` or `@nikscripts/effect-pm/QueueStore`.

## Agent checklist

1. Adapter composed at **launch** (`layerProcessStore`, `layerRuntimeStorage` + custom adapter, or `ProcessStore.layer`).
2. Domain code uses **`store.Logs` / `store.QueueStore`** or subpath re-exports — not new storage layers.
3. SQLite dep only via `@nikscripts/effect-pm/storage/sqlite`.
