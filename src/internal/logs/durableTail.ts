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
import * as LogEntry from "../../LogEntry";
import type { LogEntry as LogEntryT } from "../../LogEntry";
import type { NormalizedStoreRegistration } from "../store/registrationNormalize";
import { hasImplicitLogShape } from "../store/logShapes";
import type { StoreLogLevel } from "../store/types";
import { LogRelay, type LogRelayService } from "./relay";
import { durableTailPolicy } from "./durableTailPolicy";
import { lineIdFromEntry, makeLineIdClaim } from "./lineId";

/** @internal */
export interface DurableTail {
  readonly scopeKey: string;
  readonly storeLevel: StoreLogLevel;
  readonly match: Predicate.Predicate<LogEntryT>;
  readonly append: (entry: LogEntryT) => Effect.Effect<void>;
  readonly batchSize?: number;
  readonly batchWindow?: Duration.Input;
}

/** Handle fragment needed to append durable log rows. @internal */
export interface LogShapeHandle {
  readonly log: {
    readonly append: (
      row: LogEntryT | ReadonlyArray<LogEntryT>,
    ) => Effect.Effect<void, unknown>;
  };
}

/** @internal */
export const isLogShapeHandle = (handle: unknown): handle is LogShapeHandle => {
  if (typeof handle !== "object" || handle === null || !("log" in handle)) {
    return false;
  }
  const log = handle.log;
  return (
    typeof log === "object" &&
    log !== null &&
    "append" in log &&
    typeof log.append === "function"
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

    yield* relay.stream.pipe(
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
 * Store builds whether or not {@link Logs.layer} is present. When {@link LogRelay} is in the
 * **parent** context at layer build time (e.g. `AppStore.layerMemory.pipe(Layer.provideMerge(Logs.layer))`),
 * the tail starts; otherwise this is {@link Layer.empty}.
 *
 * @internal
 */
export const layerOptional = (options: DurableTail): Layer.Layer<never> =>
  Layer.unwrap(
    Effect.map(
      Effect.serviceOption(LogRelay),
      (opt): Layer.Layer<never> =>
        Option.isSome(opt)
          ? Layer.effectDiscard(
              Effect.forkScoped(runDurableTail(opt.value, options)).pipe(Effect.asVoid),
            )
          : Layer.empty,
    ),
  );

/**
 * Optional durable tails for registrations that carry the implicit {@link LogEntry} `log` shape.
 *
 * Resource scopes match {@link LogEntry.hasKey}; node-wide match is `() => true` (reserved for
 * `Resource.store(Node)`).
 *
 * @internal
 */
export const layersForRegistrations = (
  registrations: ReadonlyArray<NormalizedStoreRegistration>,
  handlesByAccessor: Readonly<Record<string, unknown>>,
): Layer.Layer<never> => {
  let merged: Layer.Layer<never> = Layer.empty;
  for (const registration of registrations) {
    if (!hasImplicitLogShape(registration.contract)) {
      continue;
    }
    const handle = handlesByAccessor[registration.accessor];
    if (!isLogShapeHandle(handle)) {
      continue;
    }
    const log = handle.log;
    merged = Layer.mergeAll(
      merged,
      layerOptional({
        scopeKey: registration.scopeKey,
        storeLevel: registration.logLevel ?? "All",
        match: LogEntry.hasKey(registration.scopeKey),
        append: (entry) => log.append(entry).pipe(Effect.asVoid, Effect.orDie),
      }),
    );
  }
  return merged;
};
