# Storage model (mandatory)

**One persistence stack. Domain APIs live on the merged `ProcessStore` namespace.**

## Layers

| Layer | Role |
|-------|------|
| **`RuntimeStorage`** | Raw port over normalized `RuntimeRecord` rows. |
| **`ProcessStore`** | Client API: `append`, `events`, `records`, plus **`ProcessStore.Logs`** and **`ProcessStore.QueueResource`**. |

```ts
import { ProcessStore } from "@nikscripts/effect-pm/ProcessStore";
import { layerProcessStore } from "@nikscripts/effect-pm/storage/sqlite";

const storeLayer = layerProcessStore({ filename: ".effect-pm/data.sqlite" });
```

SQLite stays on `@nikscripts/effect-pm/storage/sqlite` so the core `ProcessStore` bundle does not pull in `@effect/sql-sqlite-node`.

## Usage

```ts
yield* ProcessStore.Logs.record("my-group", "1", entry);
yield* ProcessStore.Logs.query({ groupId: "my-group", limit: 100, sort: "desc" });

yield* ProcessStore.QueueResource.withQueue("email-queue", …);
```

Instance facets remain available when you already have the store:

```ts
const { Logs, QueueResource } = yield* ProcessStore;
yield* Logs.query({ … });
```

## Do not

- Add storage `Layer`s on domain modules.
- Use `ProcessStore.file` / `storage/file` for new code.
- Add separate `@nikscripts/effect-pm/Logs` or `QueueStore` packages (use `ProcessStore.Logs` / `ProcessStore.QueueResource`).
