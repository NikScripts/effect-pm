# effect-pm

A comprehensive process orchestration system built on [Effect](https://effect.website/) that manages **supervised processes** (polling cadence + schedule gate, including cron-backed gates) and **queues**, with type-safe dependency management.

The runtime is organized around the **`ProcessGroup`** — a cohesive bundle of
processes and queues that run together. **`ProcessManager`** connects to a
group's localhost control endpoint for typed remote controls, and
**`ProcessGroup.remoteLayer`** can provide the same group service key from a
`ProcessManager.Endpoint`. `ProcessManager.cli([GroupA, GroupB] as const)`
provides the multi-group remote CLI on top of a typed connection registry.
Multi-host coordination and remote queue enqueue are still planned follow-ups.

Identifiers are slash-separated Effect-style strings with kebab-case package
segments and case-preserving service names, such as
`@repo/north-west/BillingGroup/SyncInvoices`. CLIs may accept normalized
lowercase/kebab-case aliases such as `north-west/billing-group/sync-invoices`,
while diagnostics should show canonical ids and display kind as a separate
column or label.

## Documentation map (read in any order)

| Resource | Purpose |
|-----------|---------|
| [docs/README.md](./docs/README.md) | **Index** of all committed docs in `docs/`. |
| [docs/PACKAGE-GUIDE.md](./docs/PACKAGE-GUIDE.md) | Narrative architecture: mental model, dependency rules, links. |
| [docs/PROCESS-API.md](./docs/PROCESS-API.md) | Spec-style tables for `Process`, `Polling`, `ProcessSchedule`, `ProcessGroup`, disarmed sleep helpers. |
| [docs/RESOURCE-API.md](./docs/RESOURCE-API.md) | Current `QueueResource`, `RunResource`, HTTP gate, and `HttpApiResource` APIs. |
| [docs/SCHEDULE-AND-PROCESSGROUP.md](./docs/SCHEDULE-AND-PROCESSGROUP.md) | `ProcessGroup.start` vs schedule, disarm vs `ProcessGroup.stop`, API-driven **`fromArmedRef`**. |
| [docs/AGENTS.md](./docs/AGENTS.md) | Repository map and invariants for **AI assistants** (committed; use instead of ad-hoc local notes). |
| [examples/README.md](./examples/README.md) | **Runnable examples**: commands, learning order, file index. |
| [docs/plans/README.md](./docs/plans/README.md) | Long-form architecture contracts (plan **09** = process runtime canonical). |

The package entry [`src/index.ts`](./src/index.ts) has **`@packageDocumentation`** describing exports at a glance (visible in IDEs that surface it).

## Features

- 🕐 **Managed processes** — repeat a user `Effect` with **polling** cadence and a **schedule gate** (`alwaysArmed`, `cronMatch`, or custom layers), with execution tracking ([API reference](./docs/PROCESS-API.md))
- 🎯 **Queue resources** - Advanced effect execution with priority levels, rate limiting, and concurrency control
- 🔒 **Type-Safe Dependencies** - Compile-time validation of queue dependencies
- 📊 **Built-in Monitoring** - Real-time status, metrics, and execution history
- 🎮 **Unified Control** - Single interface to manage all processes and queues
- 🔌 **Effect Integration** - Seamless integration with Effect's dependency injection system
- 🛡️ **Resource Management** - Automatic cleanup and scoped resource handling

## Installation

```bash
npm install @nikscripts/effect-pm effect
```

## Quick Start

### 1. Create a Resource Queue

```typescript
import { QueueResource } from "@nikscripts/effect-pm";
import { Effect } from "effect";

class EmailQueue extends QueueResource.Service<EmailQueue, Email, never>()(
  "email-queue",
  {
    effect: (email: Email) =>
      Effect.gen(function* () {
        // Process the email
        yield* sendEmail(email);
        yield* Effect.logInfo(email.id);
      }),
    concurrency: 5,
    capacity: 1000,
  },
) {}
```

### 2. Create a managed process

```typescript
import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
import { Cron, Duration, Effect } from "effect";

const emailProcess = Process.make("send-emails", {
  polling: Polling.spaced(Duration.minutes(5)),
  schedule: ProcessSchedule.cronMatch({
    crons: Cron.make({ minutes: [0, 30] }),
  }),
  effect: Effect.gen(function* () {
    const queue = yield* EmailQueue;
    const pendingEmails = yield* fetchPendingEmails();
    yield* queue.add(pendingEmails);
  }),
});
```

`polling` controls repeat cadence inside an instance, and `schedule` controls whether an instance stays armed and continues running.

### 3. Create a `ProcessGroup`

```typescript
import { ProcessGroup } from "@nikscripts/effect-pm";

const group = yield* ProcessGroup.make({
  queues: [EmailQueue],
  processes: [emailProcess],
});

// Start all processes
yield* group.startAll();
```

### 4. Provide Dependencies

```typescript
import { Effect, Logger } from "effect";
import { ProcessStore } from "@nikscripts/effect-pm";

const program = Effect.gen(function* () {
  const group = yield* ProcessGroup.make({
    queues: [EmailQueue],
    processes: [emailProcess],
  });
  yield* group.startAll();
});

// Run with dependencies
Effect.runPromise(
  program.pipe(
    Effect.provide(EmailQueue.layer),
    Effect.provide(ProcessStore.layer), // analytics: in-memory by default
    Effect.provide(Logger.pretty),
  )
);
```

You can merge independent layers with **`Layer.mergeAll(...)`** and a single `Effect.provide` at the root (clearer graph; matches the full demo in `examples/scenarios/full-process-group-with-queues-and-control-cli.ts`).

## QueueResource configuration

### Basic Configuration

```typescript
import { QueueResource } from "@nikscripts/effect-pm";

class TaskQueue extends QueueResource.Service<TaskQueue, Item, never>()(
  "task-queue",
  {
    effect: (item: Item) => processItem(item),
    concurrency: 3,
    capacity: 5000,
  },
) {}
```

### Advanced Configuration

```typescript
import { QueueResource } from "@nikscripts/effect-pm";
import { Effect, Exit } from "effect";

class ProcessingQueue extends QueueResource.Service<
  ProcessingQueue,
  Item,
  ProcessingError,
  never
>()(
  "processing-queue",
  {
    effect: (item: Item) => processItem(item),

    // Concurrency control
    concurrency: 5,

    // Queue capacity (memory management)
    capacity: 10000,

    // Result handling (forked; never blocks workers)
    onExit: ({ entry, exit, retry }) =>
      Exit.match(exit, {
        onFailure: () => retry,
        onSuccess: () => Effect.logInfo(`Processed ${entry.item.id}`),
      }),
    retries: 3,

    // Deduplication
    key: (item) => item.id,

    // Bootstrap or replenish work with queue-bound lifecycle hooks
    onStart: (_event, queue) =>
      Effect.gen(function* () {
        const cached = yield* getCachedItems();
        yield* queue.add(cached);
      }),
    onDrained: (_event, queue) =>
      Effect.gen(function* () {
        const next = yield* getMoreItems();
        yield* queue.add(next);
      }),
  },
) {}
```

For the full current queue surface, including `onExit`, `EffectContext`, `queue.prioritize`, `queue.defer`, and effectful status properties, see [docs/RESOURCE-API.md](./docs/RESOURCE-API.md).

## Process configuration (polling + schedule)

### Basic process (always armed)

```typescript
import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
import { Duration, Effect } from "effect";

const heartbeat = Process.make("hourly-task", {
  polling: Polling.spaced(Duration.hours(1)),
  schedule: ProcessSchedule.alwaysArmed,
  effect: Effect.logInfo("Running hourly task"),
});
```

### Cron gate + dependencies

```typescript
import { Process, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
import { Cron, Duration, Effect } from "effect";

const dataSync = Process.make("data-sync", {
  polling: Polling.spaced(Duration.minutes(1)),
  schedule: ProcessSchedule.cronMatch({
    crons: Cron.make({ minutes: [0], hours: [2] }), // 2:00 every day
  }),
  effect: Effect.gen(function* () {
    const db = yield* Database;
    const queue = yield* ProcessingQueue;

    const data = yield* db.fetchData();
    yield* queue.add(data);
  }),
});
```

While **disarmed**, running instances exit naturally on their next schedule check. The schedule driver remains attached, so future schedule openings can still spawn fresh instances. The disarmed-idle helpers (`computeDisarmedIdleSleep` / `resolveDisarmedFallbackPoll`) are exported for custom schedule layers.

To run once outside trigger cadence (even when schedule is disarmed), call `process.runImmediately()` or `group.runImmediately(name)` after the process is registered.

### Accelerating polling (speeds up, then reset)

Use **`Polling.acceleratingScoped`** (or **`Polling.accelerating`** with your own refs) when intervals should **shorten** after each tick. **`yield* Polling.resetCadence`** sets the iteration back to zero and **wakes** the current wait so spacing returns toward the configured **maximum**. Any effect that calls `resetCadence` must see the **same** `Polling` layer instance as the process (merge the layer once at the app / `ProcessGroup` boundary). For **scores-feed** forms (**basic spaced poll → minimal `resetCadence` → verbose `peekCadence`**), see **`examples/forms/polling/`** with **`examples/shared/sports-score-feed.ts`** and **`examples/shared/demo-harness.ts`** (`pnpm run example:sports-polling-accelerating`).

Runnable demo (with `TestClock`): `pnpm run example:process-supervisor-patterns`.

### API tables and exports

- **[docs/PROCESS-API.md](./docs/PROCESS-API.md)** — `Process`, `Polling`, `ProcessSchedule`, disarmed idle helpers, `ProcessGroup` lifecycle.
- Package exports also include **`computeDisarmedIdleSleep`**, **`resolveDisarmedFallbackPoll`**, and related constants for custom schedule layers and tests.

## ProcessGroup API

### Process Control

```typescript
// Start specific process
yield* group.start("email-process");

// Stop specific process
yield* group.stop("email-process");

// Restart process
yield* group.restart("email-process");

// Run process immediately (doesn't affect schedule)
yield* group.runImmediately("email-process");
```

### Global Control

```typescript
// Start all processes
yield* group.startAll();

// Stop all processes
yield* group.stopAll();

// “Restart all”: stop then start (no dedicated API)
yield* group.stopAll();
yield* group.startAll();
```

### Monitoring

```typescript
// Get single process status
const status = yield* group.processStatus("email-process");
// {
//   name: "email-process",
//   type: "managed",
//   status: "running",
//   uptime: 3600000,
//   startTime: Date,
//   lastRun: Date,
//   nextTriggerRun: Date,
//   executions: 24
// }

// Get all process and queue statuses
const allStatuses = yield* group.status;
```

### Queue Operations

```typescript
// List all queues
const queues = yield* group.listQueues();

// Get specific queue
const emailQueue = yield* group.getQueue("email-queue");
yield* emailQueue.add([email1, email2, email3]);
```

## Type Safety

The ProcessGroup enforces type-safe queue dependencies at compile time:

```typescript
import { Process, QueueResource, ProcessGroup, Polling, ProcessSchedule } from "@nikscripts/effect-pm";
import { Cron, Duration, Effect } from "effect";

class EmailQueue extends QueueResource.Service<EmailQueue, Email, SendError>()(
  "email-queue",
  {
    effect: sendEmail,
  },
) {}

const workerWithQueue = Process.make("needs-queue", {
  polling: Polling.spaced(Duration.minutes(1)),
  schedule: ProcessSchedule.cronMatch({ crons: Cron.make({ minutes: [0] }) }),
  effect: Effect.gen(function* () {
    const queue = yield* EmailQueue;
    yield* queue.add([email1, email2]);
  }),
});

// This works - EmailQueue is provided
const group = yield* ProcessGroup.make({
  queues: [EmailQueue],
  processes: [workerWithQueue],
});

// Compile error - EmailQueue is missing
const groupBad = yield* ProcessGroup.make({
  queues: [],
  processes: [workerWithQueue], // TypeScript error!
});
```

## ProcessStore (Analytics & Lifecycle)

`ProcessStore` is the unified analytics service used by `Process` and
`ProcessGroup`. It is event-first: a single `append` path with a typed
envelope, plus typed read helpers.

Supported event types out of the box:

- `process.execution.completed` — every successful or failed run
- `process.lifecycle.changed` — `Started` / `Stopped` / `Restarted` / etc.

### In-memory (development / tests)

```typescript
import { ProcessStore } from "@nikscripts/effect-pm";

program.pipe(
  Effect.provide(ProcessStore.layer), // in-memory; data lost on restart
  Effect.runPromise,
);
```

### Persistent: Prisma

`@nikscripts/effect-pm` ships a Prisma adapter on a subpath import. It uses a
single envelope-shaped table (`EffectPmEvent`) so adding new event types in
the future does not require schema migrations.

#### One-time setup

```bash
# Add the EffectPmEvent model to your Prisma schema (idempotent).
npx effect-pm add prisma

# Then generate the client and migrate as usual.
npx prisma generate
npx prisma migrate dev --name add_effect_pm_event
```

The rewriter detects single-file (`prisma/schema.prisma`) and multi-file
(`prisma/schema/`) layouts. Use `--dry-run` to preview, `--separate-file` /
`--no-separate-file` to override the placement, or `npx effect-pm prisma:print-schema`
to copy the fragment manually.

#### Usage

```typescript
import { PrismaClient } from "@prisma/client";
import { ProcessGroup } from "@nikscripts/effect-pm";
import { PrismaProcessStore } from "@nikscripts/effect-pm/storage/prisma";

const prisma = new PrismaClient();

const program = Effect.gen(function* () {
  const group = yield* ProcessGroup.make({ queues: [], processes: [...] });
  yield* group.startAll();
}).pipe(
  Effect.provide(PrismaProcessStore.layer({ client: prisma })),
);
```

If you already wire Prisma through Effect, there is a layer that consumes a
`PrismaClientService` from your environment instead:

```typescript
const layer = Layer.provide(
  PrismaProcessStore.layerFromContext,
  PrismaProcessStore.prismaClientLayer({ client: prisma }),
);
```

`@prisma/client` is an **optional peer dependency** — only required when you
opt into the Prisma subpath.

## Control Service (CLI/API)

Start an HTTP control service for external management:

```typescript
const group = yield* ProcessGroup.make({...});

// Start control service
yield* ControlService.make({ group, port: 3001 });

// Now accessible via HTTP:
// GET  /processes      - List all processes
// POST /processes/:id/start  - Start a process
// POST /processes/:id/stop   - Stop a process
// GET  /queues         - List all queues
```

## Error Handling

All operations return typed errors:

```typescript
import { 
  ProcessNotFoundError,
  ProcessAlreadyRunningError,
  ProcessNotRunningError 
} from "@nikscripts/effect-pm";

const result = yield* group.start("my-process").pipe(
  Effect.catchTags({
    ProcessNotFoundError: (err) => 
      Effect.logError(`Process not found: ${err.processName}`),
    ProcessAlreadyRunningError: (err) => 
      Effect.logInfo(`Already running: ${err.processName}`),
  })
);
```

## Best Practices

### 1. Resource Management

Always use `Effect.scoped` for long-running programs:

```typescript
const program = Effect.gen(function* () {
  const group = yield* ProcessGroup.make({...});
  yield* group.startAll();
  yield* Effect.never; // Keep running
}).pipe(Effect.scoped);
```

### 2. Queue Capacity

Set appropriate queue capacities to prevent memory issues:

```typescript
class TaskQueue extends QueueResource.Service<TaskQueue, Task, never>()(
  "task-queue",
  {
    capacity: 50000, // Adjust based on item size
    effect: processItem,
  },
) {}
```

### 3. Error Handling

Use `onExit` to observe item exits and decide whether to retry:

```typescript
class TaskQueue extends QueueResource.Service<TaskQueue, Task, TaskError>()(
  "task-queue",
  {
    effect: processItem,
    onExit: ({ entry, exit, retry }) =>
      Exit.match(exit, {
        onFailure: () =>
          Effect.gen(function* () {
            yield* saveFailedItemForRetry(entry.item);
            yield* retry;
          }),
        onSuccess: () => Effect.void,
      }),
    retries: 3,
  },
) {}
```

### 4. Priority

Use priority to keep urgent work ahead of background work:

```typescript
const queue = yield* TaskQueue;

yield* queue.add([normalTask]);
yield* queue.prioritize([urgentTask]);
yield* queue.defer([backgroundTask]);
```

## Examples

See [examples/scenarios/full-process-group-with-queues-and-control-cli.ts](./examples/scenarios/full-process-group-with-queues-and-control-cli.ts) for a complete working example with:
- Multiple queue resources
- Managed processes (polling + schedule gate)
- Full setup with dependencies
- Control service integration
- CLI usage

## API Reference

### Core Exports

- `ProcessGroup.make()` - Create a ProcessGroup instance
- `QueueResource.Service()` / `QueueResource.Tag()` - Create queue services and queue service contracts
- `Process.make(id, config)` — Create a managed process (`polling` + `schedule` layers)
- `Polling` / `ProcessSchedule` — Cadence and gate services with preset layers
- `ProcessStore` - Unified analytics & lifecycle service (in-memory by default)
- `PrismaProcessStore` - Prisma-backed `ProcessStore` (preferred subpath: `@nikscripts/effect-pm/storage/prisma`; legacy `@nikscripts/effect-pm/prisma` remains available)
- `ControlService` - HTTP control API utilities

### CLI

- `createCli()` - Create CLI command
- `runCli()` - Run CLI with config

### Types

- `ProcessGroup` - ProcessGroup interface
- `ProcessGroupDetails` - Process status information
- `QueueDetails` - Queue status information
- `QueueHandle<T, E, EEnqueue, R>` - Queue handle API (`yield*` the queue service tag)
- `Process<R>` - Process interface
- `ProcessStoreInterface` - Service contract for implementing a custom store
- `AnalyticsEvent` / `ProcessExecutionCompletedEvent` / `ProcessLifecycleChangedEvent` - Event envelope and concrete event types

### Errors

- `ProcessGroupErrors` - Local process-group error union
- `ProcessNotFoundError` - Process not found
- `ProcessAlreadyRunningError` - Process already running
- `ProcessNotRunningError` - Process not running
- `PrismaProcessStoreDecodeError` - Prisma row failed to decode into a typed event

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

