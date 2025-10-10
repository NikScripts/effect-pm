/**
 * Prisma CronStorage Implementation Example
 * 
 * This is a reference implementation showing how to create a persistent
 * CronStorage using Prisma. This file is for reference only and is not
 * included in the published package.
 * 
 * @remarks
 * To use this in your project:
 * 1. Install Prisma: `npm install @prisma/client`
 * 2. Add the CronExecution model to your schema.prisma
 * 3. Adapt this code to your needs
 * 4. Provide CronStoragePrismaLayer instead of CronStorageLive
 * 
 * @example
 * ```prisma
 * // In your schema.prisma:
 * model CronExecution {
 *   id             String   @id @default(cuid())
 *   programName    String
 *   executedAt     DateTime
 *   isStartupRun   Boolean
 *   durationMs     Int?
 *   success        Boolean
 *   errorMessage   String?
 *   createdAt      DateTime @default(now())
 * 
 *   @@index([programName])
 *   @@index([executedAt])
 * }
 * ```
 * 
 * @module examples/prisma-storage
 */

import { Effect, Layer, Context } from "effect";
import { PrismaClient } from "@prisma/client";
import {
  CronStorage,
  type CronStorageInterface,
  type ProgramCronStorage,
  type CronExecutionData,
  type CronExecution,
  type DateRange,
  CronStorageError,
} from "../src/cron-storage";

// ============================================================================
// Prisma Service
// ============================================================================

/**
 * Prisma client service
 */
class PrismaService extends Context.Tag("PrismaService")<
  PrismaService,
  PrismaClient
>() {}

/**
 * Create Prisma client layer
 */
const PrismaServiceLive = Layer.sync(PrismaService, () => {
  const prisma = new PrismaClient();
  return prisma;
});

// ============================================================================
// Prisma CronStorage Implementation
// ============================================================================

/**
 * Create Prisma-based CronStorage implementation
 * 
 * @remarks
 * This implementation persists execution history to a database using Prisma.
 * All execution history is retained across application restarts.
 */
const makePrismaCronStorage = Effect.gen(function* () {
  const prisma = yield* PrismaService;

  return {
    forProgram: (programName: string): ProgramCronStorage => ({
      recordExecution: (data: Omit<CronExecutionData, "programName">) =>
        Effect.tryPromise({
          try: () =>
            prisma.cronExecution.create({
              data: {
                programName,
                executedAt: data.executedAt,
                isStartupRun: data.isStartupRun,
                durationMs: data.durationMs ?? null,
                success: data.success,
                errorMessage: data.errorMessage ?? null,
              },
            }),
          catch: (error) =>
            new CronStorageError({
              reason: String(error),
              operation: "recordExecution",
              programName,
            }),
        }).pipe(Effect.map(() => {})),

      getExecutions: (dateRange?: DateRange) =>
        Effect.tryPromise({
          try: () =>
            prisma.cronExecution.findMany({
              where: {
                programName,
                ...(dateRange && {
                  executedAt: {
                    gte: dateRange.start,
                    lte: dateRange.end,
                  },
                }),
              },
              orderBy: {
                executedAt: "desc",
              },
            }),
          catch: (error) =>
            new CronStorageError({
              reason: String(error),
              operation: "getExecutions",
              programName,
            }),
        }).pipe(
          Effect.map((executions) =>
            executions.map(
              (e): CronExecution => ({
                id: e.id,
                programName: e.programName,
                executedAt: e.executedAt,
                isStartupRun: e.isStartupRun,
                durationMs: e.durationMs,
                success: e.success,
                errorMessage: e.errorMessage,
              })
            )
          )
        ),

      getLastRun: () =>
        Effect.tryPromise({
          try: () =>
            prisma.cronExecution.findFirst({
              where: { programName },
              orderBy: { executedAt: "desc" },
            }),
          catch: (error) =>
            new CronStorageError({
              reason: String(error),
              operation: "getLastRun",
              programName,
            }),
        }).pipe(Effect.map((execution) => execution?.executedAt ?? null)),

      getRunCount: (dateRange?: DateRange) =>
        Effect.tryPromise({
          try: () =>
            prisma.cronExecution.count({
              where: {
                programName,
                ...(dateRange && {
                  executedAt: {
                    gte: dateRange.start,
                    lte: dateRange.end,
                  },
                }),
              },
            }),
          catch: (error) =>
            new CronStorageError({
              reason: String(error),
              operation: "getRunCount",
              programName,
            }),
        }),

      getFirstStartupRun: () =>
        Effect.tryPromise({
          try: () =>
            prisma.cronExecution.findFirst({
              where: {
                programName,
                isStartupRun: true,
              },
              orderBy: { executedAt: "asc" },
            }),
          catch: (error) =>
            new CronStorageError({
              reason: String(error),
              operation: "getFirstStartupRun",
              programName,
            }),
        }).pipe(Effect.map((execution) => execution?.executedAt ?? null)),

      isFirstRunSinceRestart: () =>
        Effect.tryPromise({
          try: () =>
            prisma.cronExecution.findFirst({
              where: {
                programName,
                isStartupRun: true,
              },
            }),
          catch: (error) =>
            new CronStorageError({
              reason: String(error),
              operation: "isFirstRunSinceRestart",
              programName,
            }),
        }).pipe(Effect.map((execution) => execution === null)),
    }),
  } satisfies CronStorageInterface;
});

// ============================================================================
// Exported Layer
// ============================================================================

/**
 * Prisma CronStorage Layer
 * 
 * @remarks
 * Use this layer instead of CronStorageLive for persistent execution history.
 * 
 * **Requirements:**
 * - Prisma must be configured with the CronExecution model
 * - Database must be migrated
 * 
 * @example
 * ```typescript
 * import { CronStoragePrismaLayer } from "./examples/prisma-storage";
 * 
 * const program = Effect.gen(function* () {
 *   // Your process manager code...
 * });
 * 
 * // Provide Prisma storage instead of in-memory
 * program.pipe(
 *   Effect.provide(ProcessManagerLive),
 *   Effect.provide(CronStoragePrismaLayer), // Persistent storage
 *   Effect.runPromise
 * );
 * ```
 * 
 * @public
 */
export const CronStoragePrismaLayer = Layer.effect(
  CronStorage,
  makePrismaCronStorage
).pipe(Layer.provide(PrismaServiceLive));

// ============================================================================
// Alternative: Provide your own PrismaService
// ============================================================================

/**
 * Prisma CronStorage Layer (without PrismaService)
 * 
 * @remarks
 * Use this if you already have a PrismaService in your application.
 * You'll need to provide the PrismaService layer separately.
 * 
 * @example
 * ```typescript
 * program.pipe(
 *   Effect.provide(ProcessManagerLive),
 *   Effect.provide(CronStoragePrismaLayerNoPrisma),
 *   Effect.provide(YourPrismaServiceLayer), // Your existing Prisma layer
 *   Effect.runPromise
 * );
 * ```
 * 
 * @public
 */
export const CronStoragePrismaLayerNoPrisma = Layer.effect(
  CronStorage,
  makePrismaCronStorage
);

