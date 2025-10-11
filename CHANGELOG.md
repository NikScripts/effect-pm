# @nikscripts/effect-pm

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
    Effect.provide(CronStorage.Default) // or your custom storage
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
