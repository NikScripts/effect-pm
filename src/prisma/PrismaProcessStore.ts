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

import { Context, Data, DateTime, Effect, Layer } from "effect";
import {
  makeProcessStoreQueueResource,
  ProcessStore,
  type AnalyticsEvent,
  type ProcessExecutionCompletedEvent,
  type ProcessLifecycleChangedEvent,
  type ProcessStoreInterface,
  type QueryOpts,
  type QueueItemCompletedEvent,
  type QueueLifecycleChangedEvent,
  type StoreEventQuery,
} from "../ProcessStore";
import {
  selectRuntimeRecords,
  type RuntimeRecord,
} from "../RuntimeStorage";
import type { RuntimeRecordQuery } from "../Query";
import {
  decodeEventRow,
  encodeEvent,
  ProcessStoreEventDecodeError,
} from "../ProcessStoreCodec";
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
>()("@nikscripts/effect-pm/prisma/PrismaProcessStore/PrismaClientService") {}

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
  if (opts?.before === undefined && opts?.after === undefined) {
    return undefined;
  }
  const window: { gt?: Date; lt?: Date } = {};
  if (opts?.after !== undefined) {
    window.gt = DateTime.toDateUtc(DateTime.makeUnsafe(opts.after));
  }
  if (opts?.before !== undefined) {
    window.lt = DateTime.toDateUtc(DateTime.makeUnsafe(opts.before));
  }
  return window;
};

const buildEventQueryArgs = (query: StoreEventQuery | undefined): EffectPmEventFindManyArgs => {
  const window = buildWindow(query?.opts);
  return {
    where: {
      ...(query?.entityType === undefined ? {} : { entityType: query.entityType }),
      ...(query?.entityId === undefined ? {} : { entityId: query.entityId }),
      ...(query?.types === undefined || query.types.length === 0
        ? {}
        : { type: { in: [...query.types] } }),
      ...(window === undefined ? {} : { occurredAt: window }),
    },
    orderBy: { occurredAt: "desc" },
    ...(query?.opts?.limit !== undefined ? { take: Math.max(0, query.opts.limit) } : {}),
  };
};

class PrismaProcessStoreError extends Data.TaggedError("PrismaProcessStoreError")<{
  readonly cause: unknown;
}> {}

const findEventsOfType = <T extends AnalyticsEvent>(
  client: PrismaProcessStoreClient,
  type: T["type"],
  entityType: T["entityType"],
  entityId: string,
  opts: QueryOpts | undefined,
  refine: (event: AnalyticsEvent) => event is T,
): Effect.Effect<T[]> => {
  const window = buildWindow(opts);
  const args: EffectPmEventFindManyArgs = {
    where: {
      type,
      entityType,
      entityId,
      ...(window === undefined ? {} : { occurredAt: window }),
    },
    orderBy: { occurredAt: "desc" },
    ...(opts?.limit !== undefined ? { take: Math.max(0, opts.limit) } : {}),
  };
  return Effect.tryPromise({
    try: () => client.effectPmEvent.findMany(args),
    catch: (cause) => new PrismaProcessStoreError({ cause }),
  }).pipe(
    Effect.map((rows) => {
      const out: T[] = [];
      for (const row of rows) {
        const decoded = decodeEventRow(row);
        if (decoded instanceof ProcessStoreEventDecodeError) {
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

const isQueueItemCompleted = (
  event: AnalyticsEvent,
): event is QueueItemCompletedEvent =>
  event.type === "queue.item.completed";

const isQueueLifecycle = (
  event: AnalyticsEvent,
): event is QueueLifecycleChangedEvent =>
  event.type === "queue.lifecycle.changed";

const rowToRuntimeRecord = (row: import("../ProcessStoreEvent").EffectPmEventRow): RuntimeRecord | null => {
  const decoded = decodeEventRow(row);
  if (decoded instanceof ProcessStoreEventDecodeError) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    occurredAt: DateTime.makeUnsafe(row.occurredAt),
    createdAt: DateTime.makeUnsafe(row.createdAt),
    runId: "prisma-event-store",
    processType: row.entityType,
    processId: row.entityId,
    attributes: row.attributes ?? undefined,
  };
};

const findRuntimeRecords = (
  client: PrismaProcessStoreClient,
  query: RuntimeRecordQuery | undefined,
): Effect.Effect<RuntimeRecord[]> =>
  Effect.tryPromise({
    try: () => client.effectPmEvent.findMany(),
    catch: (cause) => new PrismaProcessStoreError({ cause }),
  }).pipe(
    Effect.map((rows) => {
      const out: RuntimeRecord[] = [];
      for (const row of rows) {
        const record = rowToRuntimeRecord(row);
        if (record !== null) {
          out.push(record);
        }
      }
      return selectRuntimeRecords(out, query);
    }),
    Effect.orDie,
  );

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
): ProcessStoreInterface => {
  const append = (event: AnalyticsEvent) =>
    Effect.tryPromise({
      try: () =>
        client.effectPmEvent.create({ data: encodeEvent(event) }).then(() => {}),
      catch: (cause) => new PrismaProcessStoreError({ cause }),
    }).pipe(Effect.orDie);
  const records = (query: RuntimeRecordQuery | undefined) => findRuntimeRecords(client, query);

  return {
    append,

    appendBatch: (events) =>
      Effect.tryPromise({
        try: () =>
          client.effectPmEvent
            .createMany({
              data: events.map(encodeEvent),
              skipDuplicates: true,
            })
            .then(() => {}),
        catch: (cause) => new PrismaProcessStoreError({ cause }),
      }).pipe(Effect.orDie),

    events: (query) =>
      Effect.tryPromise({
        try: () => client.effectPmEvent.findMany(buildEventQueryArgs(query)),
        catch: (cause) => new PrismaProcessStoreError({ cause }),
      }).pipe(
        Effect.map((rows) => {
          const out: AnalyticsEvent[] = [];
          for (const row of rows) {
            const decoded = decodeEventRow(row);
            if (!(decoded instanceof ProcessStoreEventDecodeError)) {
              out.push(decoded);
            }
          }
          return out;
        }),
        Effect.orDie,
      ),

    records,

    queueResource: makeProcessStoreQueueResource({
      append,
      records,
    }),

    getProcessExecutions: (processId, opts) =>
      findEventsOfType(
        client,
        "process.execution.completed",
        "process",
        processId,
        opts,
        isExecution,
      ),

    getProcessLifecycle: (processId, opts) =>
      findEventsOfType(
        client,
        "process.lifecycle.changed",
        "process",
        processId,
        opts,
        isLifecycle,
      ),

    getQueueItemCompletions: (queueId, opts) =>
      findEventsOfType(
        client,
        "queue.item.completed",
        "queue",
        queueId,
        opts,
        isQueueItemCompleted,
      ),

    getQueueLifecycle: (queueId, opts) =>
      findEventsOfType(
        client,
        "queue.lifecycle.changed",
        "queue",
        queueId,
        opts,
        isQueueLifecycle,
      ),
  };
};

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
