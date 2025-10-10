# ProcessManager

A comprehensive process orchestration system built on [Effect](https://effect.website/) that manages scheduled tasks (cron jobs) and priority queues with type-safe dependency management.

## Features

- 🕐 **Scheduled Tasks (Cron Jobs)** - Run tasks on customizable schedules with execution tracking
- 🎯 **Priority Queues** - Advanced task queuing with priority levels, rate limiting, and concurrency control
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

### 1. Create a Queue

```typescript
import { makeQueueService } from "@nikscripts/effect-pm";
import { Effect } from "effect";

const [EmailQueue, EmailQueueLive] = makeQueueService({
  name: "email-queue",
  processor: (email: Email) =>
    Effect.gen(function* () {
      // Process the email
      yield* sendEmail(email);
      return email.id;
    }),
  concurrency: 5,
  queueCapacity: 1000,
});
```

### 2. Create a Scheduled Task

```typescript
import { createCronProcess } from "@nikscripts/effect-pm";
import { Cron, Effect } from "effect";

const emailCron = createCronProcess({
  name: "send-emails",
  crons: Cron.make({
    minutes: [0, 30], // Every 30 minutes
    hours: [],
    days: [],
    months: [],
    weekdays: [],
  }),
  program: Effect.gen(function* () {
    const queue = yield* EmailQueue;
    const pendingEmails = yield* fetchPendingEmails();
    yield* queue.add(pendingEmails);
  }),
});
```

### 3. Create ProcessManager

```typescript
import { makeProcessManager } from "@nikscripts/effect-pm";

const pm = yield* makeProcessManager({
  queues: [EmailQueue],
  processes: [emailCron],
});

// Start all processes
yield* pm.startAll();
```

### 4. Provide Dependencies

```typescript
import { Effect, Logger } from "effect";

const program = Effect.gen(function* () {
  const pm = yield* makeProcessManager({
    queues: [EmailQueue],
    processes: [emailCron],
  });
  yield* pm.startAll();
});

// Run with dependencies
Effect.runPromise(
  program.pipe(
    Effect.provide(EmailQueueLive),
    Effect.provide(Logger.pretty),
  )
);
```

## Using the Service Layer

For applications that need dependency injection, use the service wrapper:

```typescript
import { ProcessManagerService, ProcessManagerLive } from "@nikscripts/effect-pm";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const pmFactory = yield* ProcessManagerService;
  const pm = yield* pmFactory({
    queues: [EmailQueue],
    processes: [emailCron],
  });
  
  yield* pm.startAll();
});

// Provide the service layer
program.pipe(
  Effect.provide(ProcessManagerLive),
  Effect.provide(EmailQueueLive),
  Effect.runPromise
);
```

## Priority Queue Configuration

### Basic Configuration

```typescript
const [Queue, QueueLive] = makeQueueService({
  name: "my-queue",
  processor: (item: Item) => processItem(item),
  concurrency: 3,
  queueCapacity: 5000,
});
```

### Advanced Configuration

```typescript
import { Duration } from "effect";

const [Queue, QueueLive] = makeQueueService({
  name: "advanced-queue",
  processor: processItem,
  
  // Concurrency control
  concurrency: 5,
  
  // Queue capacity (memory management)
  queueCapacity: 10000,
  
  // Rate limiting
  throttle: {
    limit: 100,                       // 100 requests
    duration: Duration.minutes(1),    // per minute
  },
  
  // Success callback (non-blocking)
  onSuccess: (result, item) => 
    Effect.logInfo(`Processed: ${result}`),
  
  // Error handling
  onError: (error, item) => 
    Effect.logError(`Failed: ${error.message}`),
  
  // Recovery from cache/database
  rebuildFunction: ({ add }) => 
    Effect.gen(function* () {
      const cached = yield* getCachedItems();
      yield* add(cached);
    }),
});
```

## Cron Process Configuration

### Basic Cron

```typescript
const basicCron = createCronProcess({
  name: "hourly-task",
  crons: Cron.make({
    minutes: [0],    // Top of the hour
    hours: [],       // Every hour
    days: [],        // Every day
    months: [],      // Every month
    weekdays: [],    // Every weekday
  }),
  program: Effect.logInfo("Running hourly task"),
});
```

### Advanced Cron with Dependencies

```typescript
const advancedCron = createCronProcess({
  name: "data-sync",
  crons: Cron.make({
    minutes: [0],
    hours: [2], // 2 AM
    days: [],
    months: [],
    weekdays: [],
  }),
  program: Effect.gen(function* () {
    const db = yield* Database;
    const queue = yield* ProcessingQueue;
    
    const data = yield* db.fetchData();
    yield* queue.add(data);
  }),
  runOnStartup: true, // Run immediately on start
});
```

## ProcessManager API

### Process Control

```typescript
// Start specific process
yield* pm.startProcess("email-cron");

// Stop specific process
yield* pm.stopProcess("email-cron");

// Restart process
yield* pm.restartProcess("email-cron");

// Run cron immediately (doesn't affect schedule)
yield* pm.runProcessImmediately("email-cron");
```

### Global Control

```typescript
// Start all processes
yield* pm.startAll();

// Stop all processes
yield* pm.stopAll();

// Restart all processes
yield* pm.restartAll();
```

### Monitoring

```typescript
// Get single process status
const status = yield* pm.getProcessStatus("email-cron");
console.log(status);
// {
//   name: "email-cron",
//   type: "scheduled",
//   status: "running",
//   uptime: 3600000,
//   startTime: Date,
//   lastRun: Date,
//   nextRun: Date,
//   runCount: 24
// }

// Get all process statuses
const allStatuses = yield* pm.getAllProcessStatus();

// List all processes
const processes = yield* pm.listProcesses();
```

### Queue Operations

```typescript
// List all queues
const queues = yield* pm.listQueues();

// Get specific queue
const emailQueue = yield* pm.getQueue("email-queue");
yield* emailQueue.add([email1, email2, email3]);
```

### Process Management

```typescript
// Remove a process
yield* pm.removeProcess("old-cron");
```

## Type Safety

The ProcessManager enforces type-safe queue dependencies at compile time:

```typescript
const cronWithQueue = createCronProcess({
  name: "needs-queue",
  crons: Cron.make({ minutes: [0] }),
  program: Effect.gen(function* () {
    const queue = yield* EmailQueue; // Uses EmailQueue
    // ...
  }),
});

// ✅ This works - EmailQueue is provided
makeProcessManager({
  queues: [EmailQueue],
  processes: [cronWithQueue],
});

// ❌ Compile error - EmailQueue is missing!
makeProcessManager({
  queues: [],
  processes: [cronWithQueue],
});
```

## Storage Options

### In-Memory Storage (Default)

```typescript
import { CronStorageLive } from "@nikscripts/effect-pm";

program.pipe(Effect.provide(CronStorageLive));
```

### Persistent Storage

For production use, implement a persistent storage layer. See `examples/prisma-storage.ts` for a complete Prisma implementation example.

```typescript
import { CronStoragePrismaLayer } from "./my-prisma-storage";

program.pipe(Effect.provide(CronStoragePrismaLayer));
```

## Control Service (CLI/API)

Start an HTTP control service for external management:

```typescript
import { startControlService } from "@nikscripts/effect-pm";

yield* startControlService({
  port: 3001,
  pm: pm,
});

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

const result = yield* pm.startProcess("my-process").pipe(
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
  const pm = yield* makeProcessManager({ ... });
  yield* pm.startAll();
  yield* Effect.never; // Keep running
}).pipe(Effect.scoped);
```

### 2. Queue Capacity

Set appropriate queue capacities to prevent memory issues:

```typescript
makeQueueService({
  name: "my-queue",
  queueCapacity: 50000, // Adjust based on item size
  // ...
});
```

### 3. Error Handling

Always provide error handlers for queues:

```typescript
makeQueueService({
  processor: processItem,
  onError: (error, item) => 
    Effect.gen(function* () {
      yield* Effect.logError(`Failed: ${error.message}`);
      yield* saveFailedItemForRetry(item);
    }),
});
```

### 4. Rate Limiting

Use throttling for external API calls:

```typescript
import { Duration } from "effect";

makeQueueService({
  processor: callExternalAPI,
  throttle: {
    limit: 10,
    duration: Duration.seconds(1),
  },
});
```

## Examples

See the [examples/example.ts](./examples/example.ts) file for a complete working example with:
- Multiple queues
- Scheduled tasks
- Full setup with dependencies
- Control service integration

## API Reference

### Core Exports

- `makeProcessManager` - Create a ProcessManager instance
- `makeQueueService` - Create a priority queue service
- `createCronProcess` - Create a scheduled task
- `startControlService` - Start HTTP control API

### Service Layer

- `ProcessManagerService` - Effect service wrapper
- `ProcessManagerLive` - Default layer with dependencies

### Types

- `ProcessManager<R>` - ProcessManager interface
- `ProcessManagerDetails` - Process status information
- `QueueDetails` - Queue status information
- `PriorityQueueProcessor<T, R>` - Queue processor interface

### Errors

- `ProcessManagerError` - General error
- `ProcessNotFoundError` - Process not found
- `ProcessAlreadyRunningError` - Process already running
- `ProcessNotRunningError` - Process not running

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

