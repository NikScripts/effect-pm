/**
 * Queue semantic storage facet for {@link ProcessStoreInterface.QueueResource}.
 *
 * @module ProcessStoreQueueResource
 */

import {
  Clock,
  Context,
  Data,
  DateTime,
  Effect,
  Layer,
  Option,
} from "effect";
import {
  And,
  Key,
  ProcessId,
  ProcessType,
  SubjectId,
  SubjectType,
  type RuntimeRecordPredicate,
} from "./Query";
import {
  makeProcessStoreSpine,
  makeRunId,
} from "./processStoreSpine";
import type {
  AnalyticsEvent,
  ProcessStoreWriteError,
  QueueLifecycleTag,
  RuntimeFactRecordedEvent,
} from "./ProcessStoreTypes";
import type { RuntimeRecordQuery } from "./Query";
import { RuntimeStorage, type RuntimeRecord } from "./RuntimeStorage";
import type { JsonValue } from "./ProcessStoreEvent";

/** @public */
export type ProcessStoreQueueResourcePriority = "high" | "normal" | "low";

/** @public */
export type ProcessStoreQueueResourceEntryStatus =
  | "enqueued"
  | "started"
  | "completed"
  | "failed"
  | "retried"
  | "exhausted"
  | "released"
  | "dead-lettered"
  | "dropped";

/** @public */
export type ProcessStoreQueueResourceLifecycleTag = QueueLifecycleTag | "Drained";

/** @public */
export type ProcessStoreQueueResourceDedupeKeyStatus =
  | "added"
  | "released"
  | "hydrated";

/** @public */
export interface ProcessStoreQueueResourceContext {
  readonly queueId?: string;
  readonly entryId?: string;
  readonly key?: string;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly dedupeKey?: string;
}

/** @public */
export interface ProcessStoreQueueResourceEntryInput {
  readonly queueId?: string;
  readonly entryId?: string;
  readonly key?: string;
  readonly priority?: ProcessStoreQueueResourcePriority;
  readonly attempts?: number;
  readonly durationMs?: number;
  readonly error?: string;
  readonly batchId?: string;
  readonly releaseId?: string;
  readonly occurredAt?: DateTime.Utc;
  readonly enqueuedAt?: DateTime.Utc;
  readonly startedAt?: DateTime.Utc;
  readonly interruptedAt?: DateTime.Utc;
  readonly payload?: JsonValue;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/** @public */
export interface ProcessStoreQueueResourceLifecycleInput {
  readonly queueId?: string;
  readonly tag: ProcessStoreQueueResourceLifecycleTag;
  readonly itemsCleared?: number;
  readonly occurredAt?: DateTime.Utc;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/** @public */
export interface ProcessStoreQueueResourceDedupeKeyInput {
  readonly queueId?: string;
  readonly key?: string;
  readonly occurredAt?: DateTime.Utc;
  readonly attributes?: { readonly [key: string]: JsonValue };
}

/** @public */
export class ProcessStoreQueueResourceContextError extends Data.TaggedError(
  "ProcessStoreQueueResourceContextError",
)<{
  readonly field: "queueId" | "entryId" | "key";
}> {}

/**
 * Queue semantic storage facet on {@link ProcessStoreInterface.QueueResource}.
 *
 * @public
 */
export interface ProcessStoreQueueResourceApi {
  readonly withQueue: <A, E, R>(
    queueId: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withEntry: <A, E, R>(
    entryId: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withBatch: <A, E, R>(
    batchId: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withDedupeKey: <A, E, R>(
    key: string,
    use: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly entryEnqueued: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryStarted: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryCompleted: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryFailed: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryRetried: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryExhausted: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryReleased: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryDeadLettered: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entryDropped: (
    input?: ProcessStoreQueueResourceEntryInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly lifecycleChanged: (
    input: ProcessStoreQueueResourceLifecycleInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly dedupeKeyAdded: (
    input?: ProcessStoreQueueResourceDedupeKeyInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly dedupeKeyReleased: (
    input?: ProcessStoreQueueResourceDedupeKeyInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly dedupeKeyHydrated: (
    input?: ProcessStoreQueueResourceDedupeKeyInput,
  ) => Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError>;
  readonly entries: (
    queueId?: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly entry: (
    entryId: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<Option.Option<RuntimeRecord>>;
  readonly entriesByKey: (
    key: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
  readonly dedupeKeys: (
    queueId?: string,
    query?: RuntimeRecordQuery,
  ) => Effect.Effect<RuntimeRecord[]>;
}

const queueResourceProcessType = "queue-resource";
const queueResourceEntrySubjectType = "queue-entry";
const queueResourceDedupeSubjectType = "queue-dedupe-key";
const queueResourceLifecycleSubjectType = "queue-lifecycle";
const queueResourceIndexNames = ["batchId", "releaseId"];

class ProcessStoreQueueResourceContextTag extends Context.Service<
  ProcessStoreQueueResourceContextTag,
  ProcessStoreQueueResourceContext
>()("@nikscripts/effect-pm/ProcessStoreQueueResource/ProcessStoreQueueResourceContextTag") {}

const currentQueueResourceContext: Effect.Effect<ProcessStoreQueueResourceContext> =
  Effect.serviceOption(ProcessStoreQueueResourceContextTag).pipe(
    Effect.map(
      Option.match({
        onNone: (): ProcessStoreQueueResourceContext => ({}),
        onSome: (context) => context,
      }),
    ),
  );

const requireQueueResourceField = (
  value: string | undefined,
  field: "queueId" | "entryId" | "key",
): Effect.Effect<string, ProcessStoreQueueResourceContextError> =>
  value === undefined
    ? Effect.fail(new ProcessStoreQueueResourceContextError({ field }))
    : Effect.succeed(value);

const withRuntimePredicate = (
  query: RuntimeRecordQuery | undefined,
  predicate: RuntimeRecordPredicate,
): RuntimeRecordQuery => ({
  ...query,
  predicate: query?.predicate === undefined
    ? predicate
    : And([predicate, query.predicate]),
});

const queueEntryPredicate = (queueId?: string): RuntimeRecordPredicate => {
  const predicates: RuntimeRecordPredicate[] = [
    ProcessType.equals(queueResourceProcessType),
    SubjectType.equals(queueResourceEntrySubjectType),
  ];
  if (queueId !== undefined) {
    predicates.push(ProcessId.equals(queueId));
  }
  return And(predicates);
};

const queueDedupePredicate = (queueId?: string): RuntimeRecordPredicate => {
  const predicates: RuntimeRecordPredicate[] = [
    ProcessType.equals(queueResourceProcessType),
    SubjectType.equals(queueResourceDedupeSubjectType),
  ];
  if (queueId !== undefined) {
    predicates.push(ProcessId.equals(queueId));
  }
  return And(predicates);
};

const dateMillis = (date: DateTime.Utc): number => DateTime.toEpochMillis(date);

const entryFactType = (status: ProcessStoreQueueResourceEntryStatus): string =>
  `queue.entry.${status}`;

const dedupeFactType = (status: ProcessStoreQueueResourceDedupeKeyStatus): string =>
  `queue.dedupe-key.${status}`;

const lifecycleFactType = (tag: ProcessStoreQueueResourceLifecycleTag): string =>
  `queue.lifecycle.${tag.toLowerCase()}`;

const entryPayload = (
  status: ProcessStoreQueueResourceEntryStatus,
  input: ProcessStoreQueueResourceEntryInput,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = { status };
  if (input.priority !== undefined) payload["priority"] = input.priority;
  if (input.attempts !== undefined) payload["attempts"] = input.attempts;
  if (input.durationMs !== undefined) payload["durationMs"] = input.durationMs;
  if (input.error !== undefined) payload["error"] = input.error;
  if (input.enqueuedAt !== undefined) payload["enqueuedAt"] = dateMillis(input.enqueuedAt);
  if (input.startedAt !== undefined) payload["startedAt"] = dateMillis(input.startedAt);
  if (input.interruptedAt !== undefined) payload["interruptedAt"] = dateMillis(input.interruptedAt);
  if (input.payload !== undefined) payload["payload"] = input.payload;
  if (input.attributes !== undefined) payload["attributes"] = input.attributes;
  return payload;
};

const lifecyclePayload = (
  input: ProcessStoreQueueResourceLifecycleInput,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = { tag: input.tag };
  if (input.itemsCleared !== undefined) {
    payload["itemsCleared"] = input.itemsCleared;
  }
  if (input.attributes !== undefined) {
    payload["attributes"] = input.attributes;
  }
  return payload;
};

const dedupePayload = (
  status: ProcessStoreQueueResourceDedupeKeyStatus,
  input: ProcessStoreQueueResourceDedupeKeyInput,
): JsonValue => {
  const payload: { [key: string]: JsonValue } = { status };
  if (input.attributes !== undefined) {
    payload["attributes"] = input.attributes;
  }
  return payload;
};

/** @internal */
export const makeProcessStoreQueueResource = (config: {
  readonly append: (event: AnalyticsEvent) => Effect.Effect<void, ProcessStoreWriteError, never>;
  readonly records: (query?: RuntimeRecordQuery) => Effect.Effect<RuntimeRecord[], never, never>;
}): ProcessStoreQueueResourceApi => {
  let sequence = 0;

  const nextFactId = (queueId: string, type: string, occurredAt: number): string => {
    sequence++;
    return `${queueId}/${type}/${String(occurredAt)}/${String(sequence)}`;
  };

  const appendFact = (
    queueId: string,
    type: string,
    occurredAt: DateTime.Utc,
    subjectType: string,
    payload: JsonValue,
    context: ProcessStoreQueueResourceContext,
    input: {
      readonly entryId?: string;
      readonly key?: string;
      readonly batchId?: string;
      readonly releaseId?: string;
    },
  ): Effect.Effect<void, ProcessStoreWriteError, never> => {
    const occurredAtMillis = dateMillis(occurredAt);
    const id = nextFactId(queueId, type, occurredAtMillis);
    const subjectId = input.entryId ?? context.entryId ?? input.key ?? context.dedupeKey ?? queueId;
    const key = input.key ?? context.key ?? context.dedupeKey;
    const batchId = input.batchId ?? context.batchId;
    const releaseId = input.releaseId ?? context.releaseId;
    const attributes: Record<string, unknown> = {
      processType: queueResourceProcessType,
      processId: queueId,
      subjectType,
      subjectId,
      indexNames: queueResourceIndexNames,
    };
    if (key !== undefined) attributes["key"] = key;
    if (batchId !== undefined) attributes["indexA"] = batchId;
    if (releaseId !== undefined) attributes["indexB"] = releaseId;

    const event: RuntimeFactRecordedEvent = {
      id,
      type: "runtime.fact.recorded",
      occurredAt: occurredAtMillis,
      entityType: queueResourceProcessType,
      entityId: queueId,
      attributes,
      fact: {
        id,
        ref: { kind: queueResourceProcessType, id: queueId },
        type,
        occurredAt: occurredAtMillis,
        payload,
        attributes,
      },
    };
    return config.append(event);
  };

  const writeEntry = (
    status: ProcessStoreQueueResourceEntryStatus,
    input: ProcessStoreQueueResourceEntryInput | undefined,
  ): Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError> =>
    Effect.gen(function* () {
      const ctx = yield* currentQueueResourceContext;
      const entryInput = input ?? {};
      const queueId = yield* requireQueueResourceField(
        entryInput.queueId ?? ctx.queueId,
        "queueId",
      );
      yield* appendFact(
        queueId,
        entryFactType(status),
        entryInput.occurredAt ?? (yield* Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)),
        queueResourceEntrySubjectType,
        entryPayload(status, entryInput),
        ctx,
        {
          entryId: entryInput.entryId,
          key: entryInput.key,
          batchId: entryInput.batchId,
          releaseId: entryInput.releaseId,
        },
      );
    });

  const writeDedupe = (
    status: ProcessStoreQueueResourceDedupeKeyStatus,
    input: ProcessStoreQueueResourceDedupeKeyInput | undefined,
  ): Effect.Effect<void, ProcessStoreQueueResourceContextError | ProcessStoreWriteError> =>
    Effect.gen(function* () {
      const ctx = yield* currentQueueResourceContext;
      const dedupeInput = input ?? {};
      const queueId = yield* requireQueueResourceField(
        dedupeInput.queueId ?? ctx.queueId,
        "queueId",
      );
      const key = yield* requireQueueResourceField(
        dedupeInput.key ?? ctx.dedupeKey ?? ctx.key,
        "key",
      );
      yield* appendFact(
        queueId,
        dedupeFactType(status),
        dedupeInput.occurredAt ?? (yield* Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)),
        queueResourceDedupeSubjectType,
        dedupePayload(status, dedupeInput),
        ctx,
        { key },
      );
    });

  return {
    withQueue: (queueId, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(Effect.provideService(ProcessStoreQueueResourceContextTag, { ...ctx, queueId }))
      ),
    withEntry: (entryId, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(Effect.provideService(ProcessStoreQueueResourceContextTag, { ...ctx, entryId }))
      ),
    withBatch: (batchId, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(Effect.provideService(ProcessStoreQueueResourceContextTag, { ...ctx, batchId }))
      ),
    withDedupeKey: (key, use) =>
      Effect.flatMap(currentQueueResourceContext, (ctx) =>
        use.pipe(
          Effect.provideService(ProcessStoreQueueResourceContextTag, {
            ...ctx,
            key,
            dedupeKey: key,
          }),
        )
      ),
    entryEnqueued: (input) => writeEntry("enqueued", input),
    entryStarted: (input) => writeEntry("started", input),
    entryCompleted: (input) => writeEntry("completed", input),
    entryFailed: (input) => writeEntry("failed", input),
    entryRetried: (input) => writeEntry("retried", input),
    entryExhausted: (input) => writeEntry("exhausted", input),
    entryReleased: (input) => writeEntry("released", input),
    entryDeadLettered: (input) => writeEntry("dead-lettered", input),
    entryDropped: (input) => writeEntry("dropped", input),
    lifecycleChanged: (input) =>
      Effect.gen(function* () {
        const ctx = yield* currentQueueResourceContext;
        const queueId = yield* requireQueueResourceField(input.queueId ?? ctx.queueId, "queueId");
        yield* appendFact(
          queueId,
          lifecycleFactType(input.tag),
          input.occurredAt ?? (yield* Effect.map(Clock.currentTimeMillis, DateTime.makeUnsafe)),
          queueResourceLifecycleSubjectType,
          lifecyclePayload(input),
          ctx,
          {},
        );
      }),
    dedupeKeyAdded: (input) => writeDedupe("added", input),
    dedupeKeyReleased: (input) => writeDedupe("released", input),
    dedupeKeyHydrated: (input) => writeDedupe("hydrated", input),
    entries: (queueId, query) =>
      config.records(withRuntimePredicate(query, queueEntryPredicate(queueId))),
    entry: (entryId, query) =>
      Effect.map(
        config.records(
          withRuntimePredicate(
            query,
            And([queueEntryPredicate(), SubjectId.equals(entryId)]),
          ),
        ),
        (rows) => rows[0] === undefined ? Option.none() : Option.some(rows[0]),
      ),
    entriesByKey: (key, query) =>
      config.records(withRuntimePredicate(query, And([queueEntryPredicate(), Key.equals(key)]))),
    dedupeKeys: (queueId, query) =>
      config.records(withRuntimePredicate(query, queueDedupePredicate(queueId))),
  };
};

const makeProcessStoreQueueResourceFromRuntimeStorage: Effect.Effect<
  ProcessStoreQueueResourceApi,
  never,
  RuntimeStorage
> = Effect.gen(function* () {
  const storage = yield* RuntimeStorage;
  const now = yield* Clock.currentTimeMillis;
  const spine = makeProcessStoreSpine(storage, makeRunId(now));
  return makeProcessStoreQueueResource({
    append: spine.append,
    records: spine.records,
  });
});

/**
 * Context tag for {@link ProcessStoreQueueResourceApi}.
 *
 * @public
 */
export class ProcessStoreQueueResource extends Context.Service<
  ProcessStoreQueueResource,
  ProcessStoreQueueResourceApi
>()("@nikscripts/effect-pm/ProcessStoreQueueResource", {
  make: makeProcessStoreQueueResourceFromRuntimeStorage,
}) {}

export namespace ProcessStoreQueueResource {
  /**
   * `Layer` that provides {@link ProcessStoreQueueResource} from injected {@link RuntimeStorage}.
   *
   * @public
   */
  export const layerRuntimeStorage: Layer.Layer<ProcessStoreQueueResource, never, RuntimeStorage> =
    Layer.effect(ProcessStoreQueueResource, makeProcessStoreQueueResourceFromRuntimeStorage);

  /**
   * `Layer` backed by in-memory {@link RuntimeStorage}.
   *
   * @public
   */
  export const layer: Layer.Layer<ProcessStoreQueueResource, never, never> = Layer.provide(
    layerRuntimeStorage,
    RuntimeStorage.layer,
  );

  export const withQueue = <A, E, R>(queueId: string, use: Effect.Effect<A, E, R>) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.withQueue(queueId, use));

  export const withEntry = <A, E, R>(entryId: string, use: Effect.Effect<A, E, R>) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.withEntry(entryId, use));

  export const withBatch = <A, E, R>(batchId: string, use: Effect.Effect<A, E, R>) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.withBatch(batchId, use));

  export const withDedupeKey = <A, E, R>(key: string, use: Effect.Effect<A, E, R>) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.withDedupeKey(key, use));

  export const entryEnqueued = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryEnqueued(input));

  export const entryStarted = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryStarted(input));

  export const entryCompleted = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryCompleted(input));

  export const entryFailed = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryFailed(input));

  export const entryRetried = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryRetried(input));

  export const entryExhausted = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryExhausted(input));

  export const entryReleased = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryReleased(input));

  export const entryDeadLettered = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryDeadLettered(input));

  export const entryDropped = (input?: ProcessStoreQueueResourceEntryInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entryDropped(input));

  export const lifecycleChanged = (input: ProcessStoreQueueResourceLifecycleInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.lifecycleChanged(input));

  export const dedupeKeyAdded = (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.dedupeKeyAdded(input));

  export const dedupeKeyReleased = (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.dedupeKeyReleased(input));

  export const dedupeKeyHydrated = (input?: ProcessStoreQueueResourceDedupeKeyInput) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.dedupeKeyHydrated(input));

  export const entries = (queueId?: string, query?: RuntimeRecordQuery) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entries(queueId, query));

  export const entry = (entryId: string, query?: RuntimeRecordQuery) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entry(entryId, query));

  export const entriesByKey = (key: string, query?: RuntimeRecordQuery) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.entriesByKey(key, query));

  export const dedupeKeys = (queueId?: string, query?: RuntimeRecordQuery) =>
    Effect.flatMap(ProcessStoreQueueResource, (store) => store.dedupeKeys(queueId, query));
}
