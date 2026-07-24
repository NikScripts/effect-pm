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
import { lineIdFromEntry, makeLineIdClaim, type LineId } from "./lineId";
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
  /**
   * Existing durable line ids for this scope (from `_logs.read` at layer acquire).
   * Seeds the in-memory claim so rematerialize does not double-append.
   */
  readonly seed?: ReadonlyArray<LineId>;
  readonly batchSize?: number;
  readonly batchWindow?: Duration.Input;
}

/** Handle fragment for the private `_logs` journal (append + read for claim seed). @internal */
export interface LogShapeHandle {
  readonly [IMPLICIT_LOGS_SHAPE_KEY]: {
    readonly append: (
      row: LogEntryT | ReadonlyArray<LogEntryT>,
    ) => Effect.Effect<void, unknown>;
    readonly read: (payload?: {
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<LogEntryT>, unknown>;
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
    typeof logs.append === "function" &&
    "read" in logs &&
    typeof logs.read === "function"
  );
};

/** Cap when seeding claim from `_logs` — retention is already applied by the shape read. */
const SEED_READ_LIMIT = 100_000;

const runDurableTail = (
  relay: LogRelayService,
  options: DurableTail,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const claim = yield* makeLineIdClaim(options.scopeKey, {
      seed: options.seed ?? [],
    });
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
 * When registrations need `_logs` and `relay` is `None`, dies — Store.Service.layer* always
 * bakes Logs; silent skip is not allowed on the public path. Prefer {@link layerOptional} only
 * for deliberate internal escapes.
 *
 * Seeds each scope's lineId claim from durable `_logs` during layer acquire (so rematerialize
 * / restart does not double-append). Not related to store-handle `memoizedAt`.
 *
 * @internal
 */
export const layersForRegistrations = (
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  handlesByAccessor: Readonly<Record<string, unknown>>,
  relay: Option.Option<LogRelayService>,
): Layer.Layer<never> => {
  const needsLogs = registrations.some((registration) =>
    hasImplicitLogShape(registration.contract),
  );
  if (needsLogs && Option.isNone(relay)) {
    return Layer.unwrap(
      Effect.die(
        "Store registrations include _logs but LogRelay is missing — use Store.Service.layer / layerMemory (bakes Logs.layer), not a partial store build",
      ),
    );
  }
  if (Option.isNone(relay)) {
    return Layer.empty;
  }
  const service = relay.value;
  // Resolve durable seeds during layer acquire (SqlClient / journal in context), then fork drains.
  return Layer.unwrap(
    Effect.gen(function* () {
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
        const match = isNode
          ? (): boolean => true
          : LogEntry.hasKey(registration.scopeKey);
        const scopeKey = registration.scopeKey;
        if (
          registration.streamLevel !== undefined &&
          registration.tag !== undefined
        ) {
          Object.assign(registration.tag, {
            [logStreamLevelSym]: registration.streamLevel,
          });
        }
        const seed = yield* logs.read({ limit: SEED_READ_LIMIT }).pipe(
          Effect.map((rows) => rows.map(lineIdFromEntry)),
          Effect.timeout(Duration.seconds(2)),
          Effect.orElseSucceed((): ReadonlyArray<LineId> => []),
        );
        merged = Layer.mergeAll(
          merged,
          layerFromRelay(service, {
            scopeKey,
            storeLevel: registration.logLevel ?? "All",
            match,
            seed,
            append: (entry) =>
              logs
                .append(isNode ? stampNodeKey(entry, scopeKey) : entry)
                .pipe(Effect.asVoid, Effect.orDie),
          }),
        );
      }
      return merged;
    }),
  );
};
