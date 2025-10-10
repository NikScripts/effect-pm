/**
 * ProcessManager Service Layer
 * 
 * Provides an Effect Service wrapper for the ProcessManager, enabling
 * dependency injection and layer-based composition in Effect applications.
 * 
 * @example
 * ```typescript
 * import { ProcessManagerService, ProcessManagerLive } from "./process-manager-service";
 * 
 * const program = Effect.gen(function* () {
 *   const pm = yield* ProcessManagerService;
 *   const manager = yield* pm({
 *     queues: [EmailQueue, NotificationQueue],
 *     processes: [emailCron, cleanupCron]
 *   });
 *   
 *   yield* manager.startAll();
 * });
 * 
 * // Provide the service layer
 * program.pipe(
 *   Effect.provide(ProcessManagerLive),
 *   Effect.runPromise
 * );
 * ```
 * 
 * @module process-manager-service
 */

import { Effect, Layer } from "effect";
import { makeProcessManager } from "./process-manager";
import { CronStorageLive } from "./cron-storage";

/**
 * ProcessManager Effect Service
 * 
 * An Effect service that provides access to the ProcessManager factory function.
 * Use this service to create ProcessManager instances with dependency injection support.
 * 
 * @remarks
 * This service wraps the `makeProcessManager` function as an Effect service,
 * allowing it to be used within the Effect dependency injection system.
 * 
 * @public
 */
export class ProcessManagerService extends Effect.Service<ProcessManagerService>()(
  "ProcessManager",
  {
    accessors: true,
    sync: () => makeProcessManager,
  }
) {}

/**
 * Default ProcessManager Layer
 * 
 * A Layer that provides both the ProcessManager service and its dependencies.
 * This includes:
 * - ProcessManagerService.Default - The default ProcessManager service
 * - CronStorageLive - In-memory cron storage implementation
 * 
 * @remarks
 * This layer uses the in-memory CronStorage implementation. For production use
 * with persistence, provide your own CronStorage layer instead.
 * 
 * @example
 * ```typescript
 * // Use default in-memory storage
 * Effect.provide(ProcessManagerLive)
 * 
 * // Or use custom storage
 * const CustomProcessManagerLive = Layer.merge(
 *   ProcessManagerService.Default,
 *   CronStoragePrismaLayer
 * );
 * ```
 * 
 * @public
 */
export const ProcessManagerLive = Layer.merge(
  ProcessManagerService.Default,
  CronStorageLive
);

