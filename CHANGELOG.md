# @nikscripts/effect-pm

## 0.5.0-beta.1

### Minor Changes

- Upgrade the Effect v4 stack to `4.0.0-beta.47` across `effect`, `@effect/platform-node`, and `@effect/vitest`.

  This keeps the package aligned with the latest v4 beta line while preserving compatibility with the current `0.5.0` prerelease APIs.

## 0.5.0-beta.0

### Minor Changes

- **Pre-1.0:** Minor bump per semver `0.x` — breaking API changes are allowed without a major (major would target `1.0.0`).

  - **`HttpApiResource`**: typed `HttpApiClient.make` with optional `limits` (same concurrency/throttle model as `RunResource`) via `HttpClientRunGate`; `acceptJson` helper; explicit service/layer typing (Effect v4 `Context.Service`).
  - **`Resource`**: `makeHttpApiClient` / `acceptJson` delegate to `HttpApiResource`.
  - **Examples**: `examples/http-api-resource.ts` (jsonplaceholder); optional local NWSL scripts (`scripts/nwsl-local.mjs`, `vitest.nwsl.config.ts`, `test:nwsl` / `example:nwsl-http-api-resource` when `examples/nwslsoccer` is present).

## 0.4.0

### Minor Changes

- - `refill` function now receives queue instance instead of methods object

    - Change: `refill: ({ add }) => ...` → `refill: (queue) => queue.add(...)`
    - Migration: Replace `methods.add()` with `queue.add()`, etc.

  - `onError` callback now receives queue instance as 3rd parameter (backward compatible)
  - `onSuccess` callback now receives queue instance as 3rd parameter (backward compatible)
  - See MIGRATION_0.4.0.md for details

## 0.3.0

### Minor Changes

- ## Breaking Changes: API Modernization (v0.3.0)

  This release modernizes the API to follow Effect's idiomatic patterns. Since the package is brand new with no active users, we're making these breaking changes now to establish a cleaner, more intuitive API.

  ### Renamed Types & Interfaces

  **Core Types:**

  - `PriorityQueueProcessor` → `QueueResource`
  - `CronHandler` → `Process`
  - `CronStorage` → `ExecutionHistory`
  - `ProcessManagerInterface` → `ProcessManager`

  **Details Types:**

  - `PoolDetails` → `QueueDetails`
  - `CronDetails` → `ScheduledProcessDetails`

  ### Renamed Factory Functions

  All factory functions now follow the `Thing.make()` pattern:

  - `makeQueueService()` → `QueueResource.make()`
  - `createCronProcess()` → `Process.make()`
  - `makeProcessManager()` → `ProcessManager.make()`

  ### Renamed Config Properties

  **QueueResource config:**

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

  The `.layer` pattern on factory tags replaces tuple returns:

  ```typescript
  // Before (v0.2.0):
  const [EmailQueue, EmailQueueLayer] = makeQueueService({...});
  Effect.provide(EmailQueueLayer)

  // After (v0.3.0):
  const EmailQueue = QueueResource.make({...});
  Effect.provide(EmailQueue.layer)
  ```

  ### Why These Changes?

  1. **Effect Conventions**: Follows `Thing.make()` and `Tag.layer` patterns
  2. **Clearer Naming**: `QueueResource` names the queued execution model alongside `RunResource` / `HttpApiResource`
  3. **Better DX**: More intuitive for Effect users
  4. **Future-Proof**: "Process" allows for non-cron processes in the future

  ### Migration Notes

  Since this package has no active users yet, no migration guide is needed. New users should follow the updated README and examples.

## 0.2.0

### Minor Changes

- bb52ea3: ---

  ## "@nikscripts/effect-pm": minor

  **BREAKING CHANGES:** Simplify API and require explicit CronStorage

  **Removed:**

  - `ProcessManagerService` - No longer needed, use `makeProcessManager` directly
  - `ProcessManagerLive` - CronStorage must now be provided explicitly

  **Changed:**

  - `CronStorage` is now a required dependency that must be explicitly provided
  - Renamed `ProcessManager<R>` type to `ProcessManagerInterface<R>` (export fix)

  **Migration Guide:**

  Before (0.1.x):

  ```typescript
  import {
    ProcessManagerService,
    ProcessManagerLive,
  } from "@nikscripts/effect-pm";

  program.pipe(Effect.provide(ProcessManagerLive), Effect.provide(QueueLive));
  ```

  After (0.2.0):

  ```typescript
  import { makeProcessManager, CronStorage } from "@nikscripts/effect-pm";

  program.pipe(
    Effect.provide(QueueLive),
    Effect.provide(CronStorage.layer) // or your custom storage
  );
  ```

  **Benefits:**

  - Cleaner API - less ceremony, more explicit dependencies
  - Better control over CronStorage implementation
  - Follows Effect patterns more closely (like Logger)

## 0.1.1

### Patch Changes

- ab48389: Export missing types required for implementing custom CronStorage and working with the API

  **Fixed Exports:**

  - `CronExecution` - Type for stored execution records (needed when implementing custom storage)
  - `CronStorageInterface` - Main storage interface to implement for custom backends
  - `CronHandler<R>` - Cron handler interface type
  - `CronDetails` - Scheduling information type
  - `ScheduledProcessDetails` - Process details type for scheduled tasks
  - `QueueProcessDetails` - Queue status and monitoring details
  - `ControlCommand` - Command type for control service

  **Impact:**

  Users can now properly implement custom CronStorage backends (e.g., Prisma, MongoDB, Redis) without type errors. Previously these types were internal but required for the public API.
