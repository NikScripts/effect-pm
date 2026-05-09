/**
 * Prisma-backed {@link ProcessStore} implementation.
 *
 * @remarks
 * Implements the same {@link ProcessStoreInterface} as
 * {@link ProcessStore.layer} but persists events to a relational database via
 * a Prisma client.
 *
 * The adapter intentionally does not import `@prisma/client`. Pass any value
 * structurally compatible with {@link PrismaProcessStoreClient} (any
 * generated `PrismaClient` will satisfy this once the schema fragment has
 * been added).
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { ProcessStore } from "@nikscripts/effect-pm";
 * import { PrismaProcessStore } from "@nikscripts/effect-pm/prisma";
 *
 * const client = new PrismaClient();
 *
 * // Plain layer:
 * const layer = PrismaProcessStore.layer({ client });
 *
 * // Or from Effect Context:
 * const layerFromContext = PrismaProcessStore.layerFromContext;
 * // ... and provide PrismaProcessStore.PrismaClientService.layer({ client })
 * ```
 *
 * @module ProcessStore/Prisma
 */

import { Context, Effect, Layer } from "effect";
import {
  ProcessStore,
  type AnalyticsEvent,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
  type ProcessStoreInterface,
  type QueryOpts,
} from "../ProcessStore";
import {
  decodeEventRow,
  encodeEvent,
  PrismaProcessStoreDecodeError,
} from "./codec";
import type {
  EffectPmEventFindManyArgs,
  PrismaProcessStoreClient,
} from "./types";

// ============================================================================
// Effect service for the structural Prisma client
// ============================================================================

/**
 * Effect Context service exposing a {@link PrismaProcessStoreClient}.
 *
 * @remarks
 * Use this when you prefer Effect-style dependency injection. The companion
 * {@link layerFromContext} consumes this service to build a
 * {@link ProcessStore} layer.
 *
 * @example
 * ```ts
 * Effect.provide(
 *   Layer.merge(
 *     PrismaProcessStore.prismaClientLayer({ client: prisma }),
 *     PrismaProcessStore.layerFromContext,
 *   ),
 * );
 * ```
 *
 * @public
 */
export class PrismaClientService extends Context.Service<
  PrismaClientService,
  PrismaProcessStoreClient
>()("@nikscripts/effect-pm/PrismaClientService") {}

/**
 * Build a layer providing {@link PrismaClientService} from a concrete client.
 *
 * @public
 */
export const prismaClientLayer = (config: {
  client: PrismaProcessStoreClient;
}): Layer.Layer<PrismaClientService> =>
  Layer.succeed(PrismaClientService, config.client);

// ============================================================================
// Builder
// ============================================================================

const buildWindow = (opts: QueryOpts | undefined) => {
  if (!opts?.before && !opts?.after) {
    return undefined;
  }
  const window: { gt?: Date; lt?: Date } = {};
  if (opts.after) window.gt = opts.after;
  if (opts.before) window.lt = opts.before;
  return window;
};

const findEventsOfType = <T extends AnalyticsEvent>(
  client: PrismaProcessStoreClient,
  type: T["type"],
  processId: string,
  opts: QueryOpts | undefined,
  refine: (event: AnalyticsEvent) => event is T,
): Effect.Effect<T[]> => {
  const args: EffectPmEventFindManyArgs = {
    where: {
      type,
      entityType: "process",
      entityId: processId,
      ...(buildWindow(opts) ? { occurredAt: buildWindow(opts) } : {}),
    },
    orderBy: { occurredAt: "desc" },
    ...(opts?.limit !== undefined ? { take: Math.max(0, opts.limit) } : {}),
  };
  return Effect.tryPromise({
    try: () => client.effectPmEvent.findMany(args),
    catch: (cause) => cause,
  }).pipe(
    Effect.map((rows) => {
      const out: T[] = [];
      for (const row of rows) {
        const decoded = decodeEventRow(row);
        if (decoded instanceof PrismaProcessStoreDecodeError) {
          continue;
        }
        if (refine(decoded)) {
          out.push(decoded);
        }
      }
      return out;
    }),
    Effect.orDie,
  );
};

const isExecution = (
  event: AnalyticsEvent,
): event is ProcessExecutionCompletedEvent =>
  event.type === "process.execution.completed";

const isLifecycle = (
  event: AnalyticsEvent,
): event is ProcessLifecycleChangedEvent =>
  event.type === "process.lifecycle.changed";

/**
 * Build a {@link ProcessStoreInterface} backed by Prisma.
 *
 * @remarks
 * Append paths use Prisma `create` / `createMany`. Read paths apply the
 * provided {@link QueryOpts} via SQL `WHERE` / `ORDER BY` / `LIMIT` so the
 * database does the work. Rows that fail to decode are skipped — they are
 * not surfaced as failures because analytics writes must remain best-effort
 * relative to the runtime path.
 *
 * @public
 */
export const make = (
  client: PrismaProcessStoreClient,
): ProcessStoreInterface => ({
  append: (event) =>
    Effect.tryPromise({
      try: () =>
        client.effectPmEvent.create({ data: encodeEvent(event) }).then(() => {}),
      catch: (cause) => cause,
    }).pipe(Effect.orDie),

  appendBatch: (events) =>
    Effect.tryPromise({
      try: () =>
        client.effectPmEvent
          .createMany({
            data: events.map(encodeEvent),
            skipDuplicates: true,
          })
          .then(() => {}),
      catch: (cause) => cause,
    }).pipe(Effect.orDie),

  getProcessExecutions: (processId, opts) =>
    findEventsOfType(
      client,
      "process.execution.completed",
      processId,
      opts,
      isExecution,
    ),

  getProcessLifecycle: (processId, opts) =>
    findEventsOfType(
      client,
      "process.lifecycle.changed",
      processId,
      opts,
      isLifecycle,
    ),
});

// ============================================================================
// Layers
// ============================================================================

/**
 * Build a `Layer` providing {@link ProcessStore} backed by Prisma directly
 * from a client instance.
 *
 * @public
 */
export const layer = (config: {
  client: PrismaProcessStoreClient;
}): Layer.Layer<ProcessStore> =>
  Layer.effect(
    ProcessStore,
    Effect.sync(() => make(config.client)),
  );

/**
 * Build a `Layer` providing {@link ProcessStore} backed by Prisma, consuming
 * a {@link PrismaClientService} from the Effect environment.
 *
 * @public
 */
export const layerFromContext: Layer.Layer<
  ProcessStore,
  never,
  PrismaClientService
> = Layer.effect(
  ProcessStore,
  Effect.gen(function* () {
    const client = yield* PrismaClientService;
    return make(client);
  }),
);
