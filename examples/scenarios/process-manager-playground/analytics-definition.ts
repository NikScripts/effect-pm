/**
 * @module examples/scenarios/process-manager-playground/analytics-definition
 *
 * Analytics group: sampler process + counter queue. Launched via `pnpm run demo:pm -- group-start analytics-group`.
 */

import { Clock, Duration, Effect } from "effect";
import {
  Endpoint,
  Polling,
  Process,
  ProcessGroup,
  ProcessSchedule,
  QueueResource,
  Transport,
} from "../../../src";
import { utcDateFromMillis } from "../../../src/utcDate";
import { analyticsPort } from "./ports";

const analyticsTransport = Transport.http(analyticsPort);
const analyticsEntry = `file://${process.cwd()}/examples/scenarios/process-manager-playground/analytics-definition.ts`;

export class CounterQueue extends QueueResource.Service<CounterQueue, number, never>()(
  "@demo/playground/Analytics/CounterQueue",
  {
    concurrency: 1,
    capacity: 500,
    effect: (value) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(`[CounterQueue] sample=${String(value)} → aggregate=${String(value * 3)}`);
        yield* Effect.sleep(Duration.millis(250));
      }),
  },
) {}

export class Sampler extends Process.Service<Sampler>()("@demo/playground/Analytics/Sampler", {
  polling: Polling.spaced(Duration.seconds(8)),
  schedule: ProcessSchedule.inMemory([
    ProcessSchedule.at("@demo/playground/Analytics/Sampler", utcDateFromMillis(0)),
  ]),
  effect: Effect.gen(function* () {
    const queue = yield* CounterQueue;
    const t = yield* Clock.currentTimeMillis;
    yield* Effect.logInfo(`[Sampler] enqueue samples around t=${String(t)}`);
    yield* queue.add([t % 100, (t + 1) % 100, (t + 2) % 100]);
  }),
}) {}

export class AnalyticsGroup extends ProcessGroup.Service<AnalyticsGroup>()(
  "@demo/playground/AnalyticsGroup",
  [Sampler, CounterQueue] as const,
  [
    Endpoint.local(analyticsTransport, analyticsEntry).default,
    Endpoint.production(analyticsTransport),
  ],
) {}
