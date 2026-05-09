# ProcessStore Service

Everything here is a suggestion — interfaces, naming, and implementation details are open for revision.

---

## Overview

`ProcessStore` is the unified storage service for effect-pm. It covers:

- Process execution history (every effect tick)
- Schedule switch events
- Process lifecycle events
- ResourcePool queue item storage

One service, one layer provided at the PM level. Individual ResourcePools can override storage behavior per-pool — see the ResourcePool storage doc for details.

---

## Service Interface

```ts
interface ProcessStore {

  // ─── Execution History ────────────────────────────────────────────────────
  recordExecution: (record: ExecutionRecord) => Effect<void>
  getExecutions: (processId: string, opts?: QueryOpts) => Effect<ExecutionRecord[]>

  // ─── Schedule Switch Events ───────────────────────────────────────────────
  recordScheduleSwitch: (event: ScheduleSwitchEvent) => Effect<void>
  getScheduleHistory: (processId: string, opts?: QueryOpts) => Effect<ScheduleSwitchEvent[]>

  // ─── Lifecycle Events ─────────────────────────────────────────────────────
  recordLifecycleEvent: (event: LifecycleEvent) => Effect<void>
  getLifecycleHistory: (processId: string, opts?: QueryOpts) => Effect<LifecycleEvent[]>

  // ─── ResourcePool Queue Storage ───────────────────────────────────────────
  // Type-agnostic — only deals with storable data, never the raw queue item type
  // Encoding/decoding is handled by the wrapping layer before reaching here
  // exit field stripped from EffectCompleteRecord before reaching service — not serializable
  // Full record type shapes defined in 08-resourcepool-types.md
  pool: {
    onEnqueued: (record: EnqueuedRecord<unknown>) => Effect<void>
    onEffectComplete: (record: EffectCompleteRecord<unknown, unknown, unknown>) => Effect<void>
    onForkComplete: (record: ForkCompleteRecord<unknown, unknown, unknown>) => Effect<void>
    onMaxRetries: (record: EnqueuedRecord<unknown>) => Effect<void>
    getPending: (
      resourceId: string,
      filter?: (record: QueueRecord<unknown, unknown, unknown>) => boolean
    ) => Effect<QueueRecord<unknown, unknown, unknown>[]>
  }

}
```

---

## Event Types

```ts
// ─── Execution Record ─────────────────────────────────────────────────────────
// Written after every effect tick completes or fails

interface ExecutionRecord {
  processId: string
  scheduleKey: string | null
  startedAt: Date
  completedAt: Date | null
  duration: Duration | null
  status: "completed" | "failed" | "interrupted"
  error?: unknown
  metadata?: Record<string, unknown>  // whatever was set via control.setMetadata
}

// ─── Schedule Switch Event ────────────────────────────────────────────────────
// Written every time the active schedule changes

interface ScheduleSwitchEvent {
  processId: string
  from: string | null
  to: string | null
  switchedAt: Date
}

// ─── Lifecycle Event ──────────────────────────────────────────────────────────
// Written on process start, stop, restart, error, recovery, enable, disable

interface LifecycleEvent {
  processId: string
  event:
    | { _tag: "Started" }
    | { _tag: "Stopped" }
    | { _tag: "Restarted" }
    | { _tag: "Errored"; error: unknown }
    | { _tag: "Recovered" }
    | { _tag: "Disabled" }
    | { _tag: "Enabled" }
  occurredAt: Date
  metadata?: Record<string, unknown>
}

// ─── Query Options ────────────────────────────────────────────────────────────

interface QueryOpts {
  limit?: number
  before?: Date
  after?: Date
}
```

ResourcePool queue record shapes (`EnqueuedRecord`, `EffectCompleteRecord`, `ForkCompleteRecord`, `QueueRecord`) are defined in `08-resourcepool-types.md`.

---

## Implementations

### File Storage (default)

Persists to the local filesystem. Default write directory is `./effect-pm-data/` relative to `process.cwd()`. Path is configurable.

```ts
ProcessManager.make({
  // no store config — file storage is the default
  processes: [...]
})

// or explicitly with options
ProcessManager.make({
  store: ProcessStore.file({ dir: "./data/effect-pm" }),
  processes: [...]
})
```

No external dependencies. Data survives restarts. Not suitable for multi-instance deployments where both instances write to the same directory.

### Prisma

Provided by effect-pm as a separate export. Requires schema setup — see Prisma setup section below.

```ts
import { PrismaProcessStore } from "effect-pm/prisma"

ProcessManager.make({
  store: PrismaProcessStore.make({ client: prismaClient }),
  processes: [...]
})
```

### Custom

Bring your own by implementing the `ProcessStore` interface:

```ts
const MyStore: ProcessStore = {
  recordExecution: (record) => ...,
  getExecutions: (processId, opts) => ...,
  // ...all other methods
}

ProcessManager.make({
  store: MyStore,
  processes: [...]
})
```

---

## Prisma Setup

The Prisma implementation ships with a setup script that adds the required models to the project's Prisma schema.

### Running the script

```bash
npx effect-pm add prisma
```

The script:

1. Locates the project's Prisma schema — checks for `prisma.config.ts`, a `prisma/schema/` folder, or falls back to `schema.prisma`
2. Detects whether multi-file schema is in use (Prisma v6.7+ GA, enabled by pointing at a folder in `prisma.config.ts`)
3. If multi-file detected — prompts to create a separate `effect-pm.prisma` file (recommended). Can be skipped with `--no-separate-file` flag
4. If single file — appends models to existing `schema.prisma`
5. Checks for existing effect-pm models to avoid duplicates (idempotent)
6. Prints a message to run `prisma migrate dev`

### Flags

```bash
npx effect-pm add prisma --separate-file      # always create separate file if supported
npx effect-pm add prisma --no-separate-file   # always append to existing schema
```

Flags bypass the prompt — useful for CI or scripted setups.

### Generated models

All models are prefixed with `EffectPm` to avoid collisions with user-defined models.

Models added (suggested — subject to change during implementation):

- `EffectPmExecution` — execution records
- `EffectPmScheduleSwitch` — schedule switch events
- `EffectPmLifecycleEvent` — lifecycle events
- `EffectPmQueueItem` — ResourcePool queue items

Each model ships with recommended indexes for common query patterns:

**EffectPmExecution:**
- Index on `processId`
- Compound index on `processId + startedAt`
- Index on `status`
- Index on `scheduleKey`

**EffectPmScheduleSwitch:**
- Index on `processId`
- Compound index on `processId + switchedAt`

**EffectPmLifecycleEvent:**
- Index on `processId`
- Compound index on `processId + occurredAt`
- Index on `event` type

**EffectPmQueueItem:**
- Index on `processId`
- Compound index on `processId + status`
- Index on `priority`
- Compound index on `processId + status + priority` (for ordered pending queries)

Users can modify indexes after setup — the script only runs once and does not overwrite manual changes.

### Prisma version note

Multi-file schema hit GA in Prisma v6.7.0 — no preview feature flag needed. Detection is based on `prisma.config.ts` schema path or presence of a `prisma/schema/` folder, not the `previewFeatures` flag. A known bug in Prisma 7.0.0 affects multi-file schema merging — the script warns if this version is detected with a potentially misconfigured schema path.

---

## Analytics Potential

With all event types flowing into the store, the following become queryable without additional instrumentation:

- Execution frequency and cadence per process
- Average and p95 duration per process and per schedule
- Failure rates and consecutive failure patterns
- Schedule switch frequency and correlation with failures
- Process uptime over time
- Queue throughput and backlog depth per pool
- Queue item success/error rates per pool

A graph and table view is a planned future addition — the data model is designed to support it from the start.
