/**
 * In-process usage sinks keyed by HttpApi (and future API) client id.
 *
 * @internal
 */
import { Clock, DateTime, Duration, Effect, Option, PubSub, Ref, Schedule, Scope, Stream } from "effect";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../ApiUsageSchema";

/** @internal */
export interface EndpointUsageEvent {
  readonly group: string;
  readonly endpoint: string;
  readonly outcome: "success" | "error";
  readonly durationMs: number;
  readonly error?: string | undefined;
}

interface EndpointWindowStats {
  readonly group: string;
  readonly endpoint: string;
  readonly requests: number;
  readonly errors: number;
  readonly durationSumMs: number;
}

interface WindowAccum {
  readonly startedAt: number;
  readonly requests: number;
  readonly errors: number;
  readonly byEndpoint: ReadonlyMap<string, EndpointWindowStats>;
}

interface UsageSink {
  readonly clientId: string;
  readonly enter: Effect.Effect<void>;
  readonly exit: Effect.Effect<void>;
  readonly record: (event: EndpointUsageEvent) => Effect.Effect<void>;
  readonly metrics: Stream.Stream<ApiUsageMetrics>;
  readonly snapshot: Effect.Effect<ApiUsageSnapshot>;
}

const endpointKey = (group: string, endpoint: string): string => `${group}\0${endpoint}`;

const freshAccum = (startedAt: number): WindowAccum => ({
  startedAt,
  requests: 0,
  errors: 0,
  byEndpoint: new Map(),
});

const defaultWindowMs = Duration.seconds(5);

const mergeEvent = (acc: WindowAccum, event: EndpointUsageEvent): WindowAccum => {
  const key = endpointKey(event.group, event.endpoint);
  const prev = acc.byEndpoint.get(key);
  const nextStats: EndpointWindowStats = {
    group: event.group,
    endpoint: event.endpoint,
    requests: (prev?.requests ?? 0) + 1,
    errors: (prev?.errors ?? 0) + (event.outcome === "error" ? 1 : 0),
    durationSumMs: (prev?.durationSumMs ?? 0) + event.durationMs,
  };
  const byEndpoint = new Map(acc.byEndpoint);
  byEndpoint.set(key, nextStats);
  return {
    startedAt: acc.startedAt,
    requests: acc.requests + 1,
    errors: acc.errors + (event.outcome === "error" ? 1 : 0),
    byEndpoint,
  };
};

const makeUsageSink = (
  clientId: string,
  windowMs: Duration.Duration,
): Effect.Effect<UsageSink, never, Scope.Scope> =>
  Effect.gen(function* () {
    const windowAccum = yield* Ref.make(freshAccum(yield* Clock.currentTimeMillis));
    const requestsTotal = yield* Ref.make(0);
    const errorsTotal = yield* Ref.make(0);
    const inFlightRef = yield* Ref.make(0);
    const cumulativeByEndpoint = yield* Ref.make(new Map<string, EndpointWindowStats>());
    const metricsHub = yield* PubSub.sliding<ApiUsageMetrics>(256);

    const emitWindow = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const acc = yield* Ref.getAndSet(windowAccum, freshAccum(now));
      const windowMillis = now - acc.startedAt;
      const inFlight = yield* Ref.get(inFlightRef);
      const byEndpoint = [...acc.byEndpoint.values()].map((row) => ({
        group: row.group,
        endpoint: row.endpoint,
        requests: row.requests,
        errors: row.errors,
        ...(row.requests > 0
          ? { avgDurationMs: row.durationSumMs / row.requests }
          : {}),
      }));
      const metrics: ApiUsageMetrics = {
        windowStart: DateTime.makeUnsafe(acc.startedAt),
        windowEnd: DateTime.makeUnsafe(now),
        windowMillis,
        requests: acc.requests,
        errors: acc.errors,
        inFlight,
        throughputPerSec: windowMillis > 0 ? (acc.requests / windowMillis) * 1000 : 0,
        byEndpoint,
      };
      yield* PubSub.publish(metricsHub, metrics);
    });

    yield* Effect.repeat(emitWindow, Schedule.spaced(windowMs)).pipe(Effect.forkScoped);

    const snapshot = Effect.gen(function* () {
      const topEndpoints = [...(yield* Ref.get(cumulativeByEndpoint)).values()]
        .map((row) => ({
          group: row.group,
          endpoint: row.endpoint,
          requests: row.requests,
          errors: row.errors,
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10);
      return {
        clientId,
        inFlight: yield* Ref.get(inFlightRef),
        requestsTotal: yield* Ref.get(requestsTotal),
        errorsTotal: yield* Ref.get(errorsTotal),
        topEndpoints,
      };
    });

    return {
      clientId,
      enter: Ref.update(inFlightRef, (n) => n + 1),
      exit: Ref.update(inFlightRef, (n) => Math.max(0, n - 1)),
      record: (event) =>
        Effect.gen(function* () {
          yield* Ref.update(requestsTotal, (n) => n + 1);
          if (event.outcome === "error") {
            yield* Ref.update(errorsTotal, (n) => n + 1);
          }
          yield* Ref.update(windowAccum, (acc) => mergeEvent(acc, event));
          yield* Ref.update(cumulativeByEndpoint, (map) => {
            const key = endpointKey(event.group, event.endpoint);
            const prev = map.get(key);
            const next = new Map(map);
            next.set(key, {
              group: event.group,
              endpoint: event.endpoint,
              requests: (prev?.requests ?? 0) + 1,
              errors: (prev?.errors ?? 0) + (event.outcome === "error" ? 1 : 0),
              durationSumMs: (prev?.durationSumMs ?? 0) + event.durationMs,
            });
            return next;
          });
          yield* emitWindow;
        }),
      metrics: Stream.fromPubSub(metricsHub),
      snapshot,
    };
  });

const sinks = new Map<string, UsageSink>();

/** @internal */
export const ensureClientUsage = (
  clientId: string,
  options?: { readonly windowMs?: Duration.Duration | undefined },
): Effect.Effect<UsageSink, never, Scope.Scope> =>
  Effect.gen(function* () {
    const existing = sinks.get(clientId);
    if (existing !== undefined) {
      return existing;
    }
    const sink = yield* makeUsageSink(clientId, options?.windowMs ?? defaultWindowMs);
    sinks.set(clientId, sink);
    return sink;
  });

/** @internal */
export const usageEnter = (clientId: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const sink = sinks.get(clientId);
    if (sink !== undefined) {
      yield* sink.enter;
    }
  });

/** @internal */
export const usageExit = (clientId: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const sink = sinks.get(clientId);
    if (sink !== undefined) {
      yield* sink.exit;
    }
  });

/** @internal */
export const recordEndpointUsage = (
  clientId: string,
  event: EndpointUsageEvent,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const sink = sinks.get(clientId);
    if (sink !== undefined) {
      yield* sink.record(event);
    }
  });

/** @internal */
export const getClientUsage = (clientId: string): Option.Option<UsageSink> =>
  Option.fromNullishOr(sinks.get(clientId));

/** @internal Test-only reset. */
export const resetClientUsageForTest = (): Effect.Effect<void> =>
  Effect.sync(() => {
    sinks.clear();
  });
