# Storage model (mandatory)

**One persistence stack. Domain APIs live on the merged `ProcessStore` namespace.**

## Layers

| Layer | Role |
|-------|------|
| **`RuntimeStorage`** | Raw port over normalized `RuntimeRecord` rows. |
| **`ProcessStore`** | Client API: `append`, `events`, `records`, plus **`ProcessStore.GroupLog`** (target name; persistence only) and **`ProcessStore.QueueResource`**. |

```ts
import { ProcessStore } from "@nikscripts/effect-pm/ProcessStore";
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";

const storeLayer = layerProcessStore({ filename: ".effect-pm/data.sqlite" });
```

SQLite stays on `@nikscripts/effect-pm/storage/sqlite` so the core `ProcessStore` bundle does not pull in `@effect/sql-sqlite-node`.

## Usage

```ts
yield* ProcessStore.GroupLog.record("my-group", "1", entry);
yield* ProcessStore.GroupLog.load({ groupId: "my-group", limit: 100, sort: "desc" });

yield* ProcessStore.QueueResource.withQueue("email-queue", …);
```

Instance facets remain available when you already have the store:

```ts
const { GroupLog, QueueResource } = yield* ProcessStore;
yield* GroupLog.load({ … });
```

Capture and live tail (group child, `pm watch`) use **`@nikscripts/effect-pm/Logs`** (`captureLoggerLayer`, `relayLayer`). Durable history uses **`ProcessStore.GroupLog`**. See [ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).

## Do not

- Add storage `Layer`s on domain modules.
- Use `ProcessStore.file` / `storage/file` for new code.
- Put `relayLayer` or `captureLoggerLayer` on `ProcessStore` (use `Logs` subpath only).
- Use two public names `Logs` (store facet + package export).
