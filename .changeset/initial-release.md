---
"@nikscripts/effect-pm": minor
---

Initial release of @nikscripts/effect-pm - Process orchestration for Effect

**Features:**

- **Scheduled Tasks (Cron):** Schedule and run tasks with cron expressions
  - Automatic execution tracking and analytics
  - Support for multiple cron schedules per task
  - Run-on-startup capability
  - Immediate execution triggers
  
- **Priority Queues:** Advanced task queuing with three priority levels
  - Configurable concurrency control
  - Rate limiting/throttling (X operations per time period)
  - Queue capacity management to prevent memory issues
  - Non-blocking success callbacks
  - Automatic cache persistence and rebuild
  - Pause/resume/restart capabilities

- **Process Manager:** Unified orchestration layer
  - Type-safe queue dependency validation at compile-time
  - Start/stop/restart controls for all processes
  - Comprehensive status monitoring and metrics
  - Process lifecycle management

- **Storage:** Flexible storage abstraction
  - In-memory storage (CronStorageLive) for development
  - Easy integration with databases (example Prisma implementation included)
  
- **Control API:** HTTP service for runtime management
  - Localhost-only API for security
  - REST endpoints for all process operations
  - Real-time status and metrics

- **CLI:** Command-line interface for process control
  - List all processes and queues
  - Start/stop/restart operations
  - Detailed status information
  - Queue monitoring

**Package Details:**

- Effect ^3.0.0 peer dependency
- Full TypeScript support with comprehensive TSDoc
- ESM and CJS builds
- Complete examples and documentation

