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

### 1. Create a Resource Pool

```typescript
import { ResourcePool } from "@nikscripts/effect-pm";
import { Effect } from "effect";

const EmailPool = ResourcePool.make({
  name: "email-pool",
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
    const pool = yield* EmailPool;
    const pendingEmails = yield* fetchPendingEmails();
    yield* pool.add(pendingEmails);
  }),
});
```

### 3. Create ProcessManager

```typescript
import { ProcessManager } from "@nikscripts/effect-pm";

const pm = yield* ProcessManager.make({
  pools: [EmailPool],
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
    pools: [EmailPool],
    processes: [emailProcess],
  });
  yield* pm.startAll();
});

// Run with dependencies
Effect.runPromise(
  program.pipe(
    Effect.provide(EmailPool.Default),
    Effect.provide(ExecutionHistory.Default),
    Effect.provide(Logger.pretty),
  )
);
```

## ResourcePool Configuration

### Basic Configuration

```typescript
import { ResourcePool } from "@nikscripts/effect-pm";

const TaskPool = ResourcePool.make({
  name: "task-pool",
  effect: (item: Item) => processItem(item),
  concurrency: 3,
  capacity: 5000,
});
```

### Advanced Configuration

```typescript
import { ResourcePool } from "@nikscripts/effect-pm";
import { Duration } from "effect";

const ProcessingPool = ResourcePool.make({
  name: "processing-pool",
  effect: processItem,
  
  // Concurrency control
  concurrency: 5,
  
  // Pool capacity (memory management)
  capacity: 10000,
  
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
  refill: ({ add }) => 
    Effect.gen(function* () {
      const cached = yield* getCachedItems();
      yield* add(cached);
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
    const pool = yield* ProcessingPool;
    
    const data = yield* db.fetchData();
    yield* pool.add(data);
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

// Restart all processes
yield* pm.restartAll();
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
//   runCount: 24
// }

// Get all process statuses
const allStatuses = yield* pm.getAllProcessStatus();

// List all processes
const processes = yield* pm.listProcesses();
```

### Pool Operations

```typescript
// List all pools
const pools = yield* pm.listPools();

// Get specific pool
const emailPool = yield* pm.getPool("email-pool");
yield* emailPool.add([email1, email2, email3]);
```

### Process Management

```typescript
// Remove a process
yield* pm.removeProcess("old-process");
```

## Type Safety

The ProcessManager enforces type-safe pool dependencies at compile time:

```typescript
import { Process, ResourcePool, ProcessManager } from "@nikscripts/effect-pm";
import { Cron, Effect } from "effect";

const EmailPool = ResourcePool.make({
  name: "email-pool",
  effect: sendEmail,
});

const cronWithPool = Process.make({
  name: "needs-pool",
  crons: Cron.make({ minutes: [0] }),
  effect: Effect.gen(function* () {
    const pool = yield* EmailPool; // Uses EmailPool
    yield* pool.add([email1, email2]);
  }),
});

// ✅ This works - EmailPool is provided
const pm = yield* ProcessManager.make({
  pools: [EmailPool],
  processes: [cronWithPool],
});

// ❌ Compile error - EmailPool is missing!
const pm = yield* ProcessManager.make({
  pools: [],
  processes: [cronWithPool],  // TypeScript error!
});
```

## ExecutionHistory (Required)

ProcessManager requires an `ExecutionHistory` implementation to track process execution history.

### In-Memory Storage (Development)

```typescript
import { ExecutionHistory } from "@nikscripts/effect-pm";

program.pipe(
  Effect.provide(ExecutionHistory.Default), // In-memory storage
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
// GET  /pools          - List all resource pools
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

### 2. Pool Capacity

Set appropriate pool capacities to prevent memory issues:

```typescript
const TaskPool = ResourcePool.make({
  name: "task-pool",
  capacity: 50000, // Adjust based on item size
  effect: processItem,
});
```

### 3. Error Handling

Always provide error handlers for resource pools:

```typescript
const TaskPool = ResourcePool.make({
  effect: processItem,
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
import { ResourcePool } from "@nikscripts/effect-pm";
import { Duration } from "effect";

const ApiPool = ResourcePool.make({
  effect: callExternalAPI,
  throttle: {
    limit: 10,
    duration: Duration.seconds(1),
  },
});
```

## Examples

See the [examples/example.ts](./examples/example.ts) file for a complete working example with:
- Multiple resource pools
- Scheduled processes
- Full setup with dependencies
- Control service integration
- CLI usage

## API Reference

### Core Exports

- `ProcessManager.make()` - Create a ProcessManager instance
- `ResourcePool.make()` - Create a resource pool
- `Process.make()` - Create a scheduled process
- `ExecutionHistory` - Service for tracking process execution history
- `ControlService` - HTTP control API utilities

### CLI

- `createCli()` - Create CLI command
- `runCli()` - Run CLI with config

### Types

- `ProcessManager` - ProcessManager interface
- `ProcessManagerDetails` - Process status information
- `PoolDetails` - Pool status information
- `ResourcePool<T, R>` - Resource pool interface
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

