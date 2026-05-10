# effect-pm

A comprehensive process orchestration system built on [Effect](https://effect.website/) that manages scheduled tasks (cron jobs) and queues with type-safe dependency management.

The runtime is organized around the **`ProcessGroup`** — a cohesive bundle of
processes and queues that run together. A future top-level **`ProcessManager`**
(not yet implemented) will coordinate multiple `ProcessGroup` instances across
hosts via Effect RPC / HTTP. For now, use one `ProcessGroup` per logical
bundle.

## Features

- 🕐 **Scheduled Tasks (Cron Jobs)** - Run tasks on customizable schedules with execution tracking
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

const EmailQueue = QueueResource.make({
  name: "email-queue",
  effect: (email: Email) =>
    Effect.gen(function* () {
      // Process the email
      yield* sendEmail(email);
      return email.id;
    }),
  concurrency: 5,
  capacity: 1000,
});
```

### 2. Create a Scheduled Process

```typescript
import { Process } from "@nikscripts/effect-pm";
import { Cron, Effect } from "effect";

const emailProcess = Process.make({
  name: "send-emails",
  crons: Cron.make({
    minutes: [0, 30], // Every 30 minutes
  }),
  effect: Effect.gen(function* () {
    const queue = yield* EmailQueue;
    const pendingEmails = yield* fetchPendingEmails();
    yield* queue.add(pendingEmails);
  }),
});
```

### 3. Create ProcessGroup

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

## QueueResource configuration

### Basic Configuration

```typescript
import { QueueResource } from "@nikscripts/effect-pm";

const TaskQueue = QueueResource.make({
  name: "task-queue",
  effect: (item: Item) => processItem(item),
  concurrency: 3,
  capacity: 5000,
});
```

### Advanced Configuration

```typescript
import { QueueResource } from "@nikscripts/effect-pm";
import { Duration } from "effect";

const ProcessingQueue = QueueResource.make({
  name: "processing-queue",
  effect: processItem,
  
  // Concurrency control
  concurrency: 5,
  
  // Queue capacity (memory management)
  capacity: 10000,
  
  // Rate limiting
  throttle: {
    limit: 100,                       // 100 requests
    duration: Duration.minutes(1),    // per minute
  },
  
  // Success callback (non-blocking)
  onSuccess: (result, item, queue) => 
    Effect.gen(function* () {
      yield* Effect.logInfo(`Processed: ${result}`);
      // Queue instance available for adding follow-up tasks or lifecycle control
    }),
  
  // Error handling
  onError: (error, item, queue) => 
    Effect.gen(function* () {
      yield* Effect.logError(`Failed: ${error.message}`);
      // Queue instance available for lifecycle control if needed
    }),
  
  // Recovery from cache/database
  refill: (queue) => 
    Effect.gen(function* () {
      const cached = yield* getCachedItems();
      yield* queue.add(cached);
    }),
});
```

## Process Configuration (Scheduled Tasks)

### Basic Scheduled Process

```typescript
import { Process } from "@nikscripts/effect-pm";
import { Cron, Effect } from "effect";

const hourlyTask = Process.make({
  name: "hourly-task",
  crons: Cron.make({
    minutes: [0],    // Top of the hour
  }),
  effect: Effect.logInfo("Running hourly task"),
});
```

### Advanced Process with Dependencies

```typescript
const dataSync = Process.make({
  name: "data-sync",
  crons: Cron.make({
    minutes: [0],
    hours: [2], // 2 AM
  }),
  effect: Effect.gen(function* () {
    const db = yield* Database;
    const queue = yield* ProcessingQueue;
    
    const data = yield* db.fetchData();
    yield* queue.add(data);
  }),
  runOnStartup: true, // Run immediately on start
});
```

## ProcessGroup API

### Process Control

```typescript
// Start specific process
yield* group.startProcess("email-process");

// Stop specific process
yield* group.stopProcess("email-process");

// Restart process
yield* group.restartProcess("email-process");

// Run process immediately (doesn't affect schedule)
yield* group.runProcessImmediately("email-process");
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
const status = yield* group.getProcessStatus("email-process");
console.log(status);
// {
//   name: "email-process",
//   type: "scheduled",
//   status: "running",
//   uptime: 3600000,
//   startTime: Date,
//   lastRun: Date,
//   nextRun: Date,
//   executions: 24
// }

// Get all process statuses
const allStatuses = yield* group.getAllProcessStatus();

// List all processes
const processes = yield* group.listProcesses();
```

### Queue Operations

```typescript
// List all queues
const queues = yield* group.listQueues();

// Get specific queue
const emailQueue = yield* group.getQueue("email-queue");
yield* emailQueue.add([email1, email2, email3]);
```

### Process Management

```typescript
// Remove a process
yield* group.removeProcess("old-process");
```

## Type Safety

The ProcessGroup enforces type-safe queue dependencies at compile time:

```typescript
import { Process, QueueResource, ProcessGroup } from "@nikscripts/effect-pm";
import { Cron, Effect } from "effect";

const EmailQueue = QueueResource.make({
  name: "email-queue",
  effect: sendEmail,
});

const cronWithQueue = Process.make({
  name: "needs-queue",
  crons: Cron.make({ minutes: [0] }),
  effect: Effect.gen(function* () {
    const queue = yield* EmailQueue; // Uses EmailQueue
    yield* queue.add([email1, email2]);
  }),
});

// ✅ This works - EmailQueue is provided
const group = yield* ProcessGroup.make({
  queues: [EmailQueue],
  processes: [cronWithQueue],
});

// ❌ Compile error - EmailQueue is missing!
const groupBad = yield* ProcessGroup.make({
  queues: [],
  processes: [cronWithQueue],  // TypeScript error!
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
import { PrismaProcessStore } from "@nikscripts/effect-pm/prisma";

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
yield* group.serve({ port: 3001 });

// Now accessible via HTTP:
// GET  /processes      - List all processes
// POST /process/start  - Start a process
// POST /process/stop   - Stop a process
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

const result = yield* group.startProcess("my-process").pipe(
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
const TaskQueue = QueueResource.make({
  name: "task-queue",
  capacity: 50000, // Adjust based on item size
  effect: processItem,
});
```

### 3. Error Handling

Always provide error handlers for queue resources:

```typescript
const TaskQueue = QueueResource.make({
  effect: processItem,
  onError: (error, item, queue) => 
    Effect.gen(function* () {
      yield* Effect.logError(`Failed: ${error.message}`);
      yield* saveFailedItemForRetry(item);
      // Queue instance available for lifecycle control if needed
    }),
});
```

### 4. Rate Limiting

Use throttling for external API calls:

```typescript
import { QueueResource } from "@nikscripts/effect-pm";
import { Duration } from "effect";

const ApiQueue = QueueResource.make({
  effect: callExternalAPI,
  throttle: {
    limit: 10,
    duration: Duration.seconds(1),
  },
});
```

## Examples

See the [examples/example.ts](./examples/example.ts) file for a complete working example with:
- Multiple queue resources
- Scheduled processes
- Full setup with dependencies
- Control service integration
- CLI usage

## API Reference

### Core Exports

- `ProcessGroup.make()` - Create a ProcessGroup instance
- `QueueResource.make()` - Create a resource queue
- `Process.make()` - Create a scheduled process
- `ProcessStore` - Unified analytics & lifecycle service (in-memory by default)
- `PrismaProcessStore` - Prisma-backed `ProcessStore` (subpath: `@nikscripts/effect-pm/prisma`)
- `ControlService` - HTTP control API utilities

### CLI

- `createCli()` - Create CLI command
- `runCli()` - Run CLI with config

### Types

- `ProcessGroup` - ProcessGroup interface
- `ProcessGroupDetails` - Process status information
- `QueueDetails` - Queue status information
- `QueueRef<Name, T, R, E>` - Queue handle API (`yield*` the tag from `QueueResource.make`); `Name` is the literal `name`; `QueueResourceInterface` is a legacy 3-param alias (`Name` widened to `string`)
- `Process<R>` - Process interface
- `ProcessStoreInterface` - Service contract for implementing a custom store
- `AnalyticsEvent` / `ProcessExecutionCompletedEvent` / `ProcessLifecycleChangedEvent` - Event envelope and concrete event types

### Errors

- `ProcessGroupError` - General error
- `ProcessNotFoundError` - Process not found
- `ProcessAlreadyRunningError` - Process already running
- `ProcessNotRunningError` - Process not running
- `PrismaProcessStoreDecodeError` - Prisma row failed to decode into a typed event

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

