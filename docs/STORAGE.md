# Storage model (mandatory)

**There is one persistence stack. Do not invent another.**

## Layers

| Layer | Role |
|-------|------|
| **`RuntimeStorage`** | Raw port over normalized `RuntimeRecord` rows. Swap adapters here: `RuntimeStorage.memory`, `SQLiteRuntimeStorage`, Prisma (future), … |
| **`ProcessStore`** | Client API on top of `RuntimeStorage`: `append`, `events`, queue helpers, runtime projections |

Domain modules (`Logs`, `QueueResource`, processes) **use `ProcessStore`**. They **do not** expose their own storage `Layer`s or SQLite/file shortcuts.

## How to compose durability

```ts
import { Layer } from "effect";
import { ProcessStore } from "@nikscripts/effect-pm/ProcessStore";
import { SQLiteRuntimeStorage } from "@nikscripts/effect-pm/storage/sqlite";

// Canonical local durable stack (preferred helper):
const storeLayer = ProcessStore.layerSqlite({ filename: ".effect-pm/data.sqlite" });

// Equivalent explicit form:
const storeLayerExplicit = Layer.provide(
  ProcessStore.layerRuntimeStorage,
  SQLiteRuntimeStorage.layer({ filename: ".effect-pm/data.sqlite" }),
);

// Tests / demos without disk:
const memoryLayer = ProcessStore.layer;
```

Provide the chosen `ProcessStore` layer at **app or group-child launch**. Every effect that needs persistence runs with that layer in scope.

## Logs

`@nikscripts/effect-pm/Logs` only encodes and queries `group.log.entry` events **through `ProcessStore`**:

- `Logs.record` / `Logs.recordBatch` → `ProcessStore.append`
- `Logs.load` / `Logs.query` → `ProcessStore.events`

**No `Logs.layer`.** Group child uses `ProcessStore.layerSqlite` + `groupLogSqlitePath` (path convention under `processManagerChildLaunch`, not storage API).

## Do not use for new code

- `ProcessStore.file` / `ProcessStore.fileLayer`
- `@nikscripts/effect-pm/storage/file`
- Any new “log store layer”, “analytics file layer”, or domain module that composes SQLite under its own name

## Agent checklist

Before adding persistence code, answer:

1. Am I writing to **`RuntimeStorage`** (adapter) or **`ProcessStore`** (client)?
2. Is the `RuntimeStorage` adapter composed at the **root** only?
3. Did I avoid adding storage `Layer`s to `Logs`, `ProcessManager`, or other domain modules?

If any answer is wrong, stop and fix the composition site.
