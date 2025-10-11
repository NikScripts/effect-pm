# @nikscripts/effect-pm

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

