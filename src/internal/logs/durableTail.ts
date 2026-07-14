/**
 * Durable log store tail — one Stream drain over {@link LogRelay} per registration scope.
 *
 * @module internal/logs/durableTail
 * @internal
 */

import {
  Duration,
  Effect,
  Layer,
  Option,
  Stream,
} from "effect";
import type { Predicate } from "effect";
import { LogAnnotationKeys } from "../../LogContext";
import * as LogEntry from "../../LogEntry";
import type { LogEntry as LogEntryT } from "../../LogEntry";
import type { NormalizedStoreRegistration } from "../store/registrationNormalize";
import { hasImplicitLogShape, IMPLICIT_LOGS_SHAPE_KEY } from "../store/logShapes";
import type { StoreLogLevel } from "../store/types";
import { LogRelay, type LogRelayService } from "./relay";
import { durableTailPolicy } from "./durableTailPolicy";
import { lineIdFromEntry, makeLineIdClaim } from "./lineId";
import { logStreamLevelSym } from "./streamLevel";

const stampNodeKey = (entry: LogEntryT, nodeKey: string): LogEntryT =>
  entry.annotations[LogAnnotationKeys.node] !== undefined
    ? entry
    : {
        ...entry,
        annotations: {
          ...entry.annotations,
          [LogAnnotationKeys.node]: nodeKey,
        },
      };

/** @internal */
export interface DurableTail {
  readonly scopeKey: string;
  readonly storeLevel: StoreLogLevel;
  readonly match: Predicate.Predicate<LogEntryT>;
  readonly append: (entry: LogEntryT) => Effect.Effect<void>;
  readonly batchSize?: number;
  readonly batchWindow?: Duration.Input;
}

/** Handle fragment needed to append durable log rows (`_logs` — not on public handle types). @internal */
export interface LogShapeHandle {
  readonly [IMPLICIT_LOGS_SHAPE_KEY]: {
    readonly append: (
      row: LogEntryT | ReadonlyArray<LogEntryT>,
    ) => Effect.Effect<void, unknown>;
  };
}

/** @internal */
export const isLogShapeHandle = (handle: unknown): handle is LogShapeHandle => {
  if (typeof handle !== "object" || handle === null || !(IMPLICIT_LOGS_SHAPE_KEY in handle)) {
    return false;
  }
  const logs = handle[IMPLICIT_LOGS_SHAPE_KEY];
  return (
    typeof logs === "object" &&
    logs !== null &&
    "append" in logs &&
    typeof logs.append === "function"
  );
};

const runDurableTail = (
  relay: LogRelayService,
  options: DurableTail,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const claim = yield* makeLineIdClaim(options.scopeKey);
    const policy = durableTailPolicy(options);
    const batchSize = options.batchSize ?? 64;
    const batchWindow = options.batchWindow ?? "250 millis";
    // Snapshot prefix + live bus — same shape as public `Logs.stream`, so lines published
    // before the subscriber attaches are not dropped.
    const tail = yield* relay.snapshot;
    const source = Stream.concat(Stream.fromIterable(tail), relay.stream);

    yield* source.pipe(
      Stream.filter(policy),
      Stream.filterEffect((entry) => claim(lineIdFromEntry(entry))),
      Stream.groupedWithin(batchSize, batchWindow),
      Stream.mapEffect((batch) =>
        Effect.forEach(batch, options.append, { concurrency: 1, discard: true }),
      ),
      Stream.runDrain,
    );
  });

/**
 * Forks the durable tail in the layer Scope. Requires {@link LogRelay}.
 *
 * @internal
 */
export const layer = (options: DurableTail): Layer.Layer<never, never, LogRelay> =>
  Layer.effectDiscard(
    Effect.flatMap(LogRelay, (relay) =>
      Effect.forkScoped(runDurableTail(relay, options)).pipe(Effect.asVoid),
    ),
  );

/**
 * Closed tail layer over an already-resolved relay (no further LogRelay lookup).
 *
 * @internal
 */
export const layerFromRelay = (
  relay: LogRelayService,
  options: DurableTail,
): Layer.Layer<never> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      yield* Effect.forkScoped(runDurableTail(relay, options));
      // Let the forked drain pull once so PubSub subscribe is attached before the
      // app's first Effect.log publish (scheduleTask) races past an empty subscriber set.
      yield* Effect.yieldNow;
    }).pipe(Effect.asVoid),
  );

/**
 * When {@link LogRelay} is already in context, fork a closed tail; else {@link Layer.empty}.
 * {@link Store} `layerMemory` / `layer` bake in the logs layer, so tails normally start.
 *
 * Prefer {@link layersForRegistrations} at the store unwrap site (captures relay once).
 *
 * @internal
 */
export const layerOptional = (options: DurableTail): Layer.Layer<never> =>
  Layer.unwrap(
    Effect.map(
      Effect.serviceOption(LogRelay),
      (opt): Layer.Layer<never> =>
        Option.isSome(opt) ? layerFromRelay(opt.value, options) : Layer.empty,
    ),
  );

/**
 * Durable tails for registrations that carry the implicit {@link LogEntry} `_logs` shape.
 *
 * Pass the {@link LogRelay} resolved in the same store-layer unwrap that builds the bundle.
 * When `relay` is `None`, returns {@link Layer.empty}. Resource scopes match {@link LogEntry.hasKey}.
 *
 * @internal
 */
export const layersForRegistrations = (
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  handlesByAccessor: Readonly<Record<string, unknown>>,
  relay: Option.Option<LogRelayService>,
): Layer.Layer<never> => {
  if (Option.isNone(relay)) {
    return Layer.empty;
  }
  const service = relay.value;
  let merged: Layer.Layer<never> = Layer.empty;
  for (const registration of registrations) {
    if (!hasImplicitLogShape(registration.contract)) {
      continue;
    }
    const handle = handlesByAccessor[registration.accessor];
    if (!isLogShapeHandle(handle)) {
      continue;
    }
    const logs = handle[IMPLICIT_LOGS_SHAPE_KEY];
    const isNode = registration.journal === "node";
    const match = isNode ? (): boolean => true : LogEntry.hasKey(registration.scopeKey);
    const scopeKey = registration.scopeKey;
    // Registration `Store.streamLevel*` stamps the tag so {@link Resource.logs} can read it.
    if (registration.streamLevel !== undefined && registration.tag !== undefined) {
      Object.assign(registration.tag, {
        [logStreamLevelSym]: registration.streamLevel,
      });
    }
    merged = Layer.mergeAll(
      merged,
      layerFromRelay(service, {
        scopeKey,
        storeLevel: registration.logLevel ?? "All",
        match,
        append: (entry) =>
          logs
            .append(isNode ? stampNodeKey(entry, scopeKey) : entry)
            .pipe(Effect.asVoid, Effect.orDie),
      }),
    );
  }
  return merged;
};
