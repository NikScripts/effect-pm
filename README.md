# ProcessManager

A comprehensive process orchestration system built on [Effect](https://effect.website/) that manages scheduled tasks (cron jobs) and queues with type-safe dependency management.

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

### 3. Create ProcessManager

```typescript
import { ProcessManager } from "@nikscripts/effect-pm";

const pm = yield* ProcessManager.make({
  queues: [EmailQueue],
  processes: [emailProcess],
});

// Start all processes
yield* pm.startAll();
```

### 4. Provide Dependencies

```typescript
import { Effect, Logger } from "effect";
import { ExecutionHistory } from "@nikscripts/effect-pm";

const program = Effect.gen(function* () {
  const pm = yield* ProcessManager.make({
    queues: [EmailQueue],
    processes: [emailProcess],
  });
  yield* pm.startAll();
});

// Run with dependencies
Effect.runPromise(
  program.pipe(
    Effect.provide(EmailQueue.layer),
    Effect.provide(ExecutionHistory.layer),
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

## ProcessManager API

### Process Control

```typescript
// Start specific process
yield* pm.startProcess("email-process");

// Stop specific process
yield* pm.stopProcess("email-process");

// Restart process
yield* pm.restartProcess("email-process");

// Run process immediately (doesn't affect schedule)
yield* pm.runProcessImmediately("email-process");
```

### Global Control

```typescript
// Start all processes
yield* pm.startAll();

// Stop all processes
yield* pm.stopAll();

// “Restart all”: stop then start (no dedicated API)
yield* pm.stopAll();
yield* pm.startAll();
```

### Monitoring

```typescript
// Get single process status
const status = yield* pm.getProcessStatus("email-process");
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
yield* pm.removeProcess("old-process");
```

## Type Safety

The ProcessManager enforces type-safe queue dependencies at compile time:

```typescript
import { Process, QueueResource, ProcessManager } from "@nikscripts/effect-pm";
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
const pm = yield* ProcessManager.make({
  queues: [EmailQueue],
  processes: [cronWithQueue],
});

// ❌ Compile error - EmailQueue is missing!
const pm = yield* ProcessManager.make({
  queues: [],
  processes: [cronWithQueue],  // TypeScript error!
});
```

## ExecutionHistory (Required)

ProcessManager requires an `ExecutionHistory` implementation to track process execution history.

### In-Memory Storage (Development)

```typescript
import { ExecutionHistory } from "@nikscripts/effect-pm";

program.pipe(
  Effect.provide(ExecutionHistory.layer), // In-memory storage
  Effect.runPromise
);
```

**⚠️ Warning:** In-memory storage loses all execution history on restart. A warning will be displayed when using the default implementation.

### Persistent Storage (Production)

For production, implement a persistent storage layer. See `examples/prisma-storage.ts` for a complete Prisma implementation example.

```typescript
import { ExecutionHistoryPrismaLayer } from "./my-prisma-storage";

program.pipe(
  Effect.provide(ExecutionHistoryPrismaLayer), // Persistent storage
  Effect.runPromise
);
```

## Control Service (CLI/API)

Start an HTTP control service for external management:

```typescript
const pm = yield* ProcessManager.make({...});

// Start control service
yield* pm.listen({ port: 3001 });

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
  const pm = yield* ProcessManager.make({...});
  yield* pm.startAll();
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

- `ProcessManager.make()` - Create a ProcessManager instance
- `QueueResource.make()` - Create a resource queue
- `Process.make()` - Create a scheduled process
- `ExecutionHistory` - Service for tracking process execution history
- `ControlService` - HTTP control API utilities

### CLI

- `createCli()` - Create CLI command
- `runCli()` - Run CLI with config

### Types

- `ProcessManager` - ProcessManager interface
- `ProcessManagerDetails` - Process status information
- `QueueDetails` - Queue status information
- `QueueResourceInterface<T, R, E>` - Queue resource (queue) instance API
- `Process<R>` - Process interface
- `ExecutionHistoryInterface` - Storage interface for implementing custom storage
- `Execution` - Execution record type

### Errors

- `ProcessManagerError` - General error
- `ProcessNotFoundError` - Process not found
- `ProcessAlreadyRunningError` - Process already running
- `ProcessNotRunningError` - Process not running
- `ExecutionHistoryError` - Storage operation error

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

