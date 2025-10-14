---
"@nikscripts/effect-pm": major
---

## Breaking Changes: API Modernization (v0.3.0)

This release modernizes the API to follow Effect's idiomatic patterns. Since the package is brand new with no active users, we're making these breaking changes now to establish a cleaner, more intuitive API.

### Renamed Types & Interfaces

**Core Types:**
- `PriorityQueueProcessor` → `ResourcePool`
- `CronHandler` → `Process`
- `CronStorage` → `ExecutionHistory`
- `ProcessManagerInterface` → `ProcessManager`

**Details Types:**
- `QueueDetails` → `PoolDetails`
- `CronDetails` → `ScheduledProcessDetails`

### Renamed Factory Functions

All factory functions now follow the `Thing.make()` pattern:

- `makeQueueService()` → `ResourcePool.make()`
- `createCronProcess()` → `Process.make()`
- `makeProcessManager()` → `ProcessManager.make()`

### Renamed Config Properties

**ResourcePool config:**
- `processor` → `effect`
- `queueCapacity` → `capacity`
- `rebuildFromCache` → `refill`
- `cacheFunction` → `cache`

**Process config:**
- `program` → `effect`

### Renamed Service Methods

**ProcessManager:**
- `pm.startControlService()` → `pm.serve()` or `pm.listen()`

**Details Properties:**
- `runCount` → `executions`
- `queueSize` → `size`
- `processedCount` → `completed`
- `workerCount` → `workers`
- `isRunning` → `running`

### Layer Pattern Change

The `.Default` pattern replaces tuple returns:

```typescript
// Before (v0.2.0):
const [EmailQueue, EmailQueueLayer] = makeQueueService({...});
Effect.provide(EmailQueueLayer)

// After (v0.3.0):
const EmailPool = ResourcePool.make({...});
Effect.provide(EmailPool.Default)
```

### Why These Changes?

1. **Effect Conventions**: Follows Effect's `Thing.make()` and `.Default` patterns
2. **Clearer Naming**: "ResourcePool" better describes what it does than "PriorityQueue"
3. **Better DX**: More intuitive for Effect users
4. **Future-Proof**: "Process" allows for non-cron processes in the future

### Migration Notes

Since this package has no active users yet, no migration guide is needed. New users should follow the updated README and examples.

