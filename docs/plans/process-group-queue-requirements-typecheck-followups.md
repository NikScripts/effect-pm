# Follow-up: queue `R` literals vs `Effect.provide` (typecheck backlog)

**Status**: addressed in current `main` — examples, tests, and **`pnpm run typecheck`** succeed with **`ProcessGroupQueueEnqueueRequirements`** typed from queue **`layer`** outputs and **`ProcessGroup`** layer merges.

Historical root cause summary:

Typed `ProcessGroup.make` declares queue slot requirements keyed by **`ProcessGroupQueueEntries<Entries>["id"]`**. **`Effect.provide(layer)`** removes keys from **`R`** via **`Exclude`**, which only aligns when **`layer`** exposes the **exact** **`Context`** keys for those queues; bundled **`ProcessGroup.Service.layer`** remerges **`QueueResource.Service.layer`** outputs so subtraction matches.

Enqueue-time requirements are surfaced separately via **`ProcessGroupQueueEnqueueRequirements`** (`src/ProcessGroup.ts`).

For prior failing-file listing and sequencing notes, see git history on this doc.
