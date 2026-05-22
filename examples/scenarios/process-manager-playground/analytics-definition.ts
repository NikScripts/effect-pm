/**
 * @module examples/scenarios/process-manager-playground/analytics-definition
 *
 * Analytics group: sampler process + counter queue + `AnalyticsRuntime`. Launched via `pnpm run demo:pm -- group-start analytics-group`.
 */

import { Clock, Duration, Effect, Layer } from "effect";
import {
  ControlService,
  Endpoint,
  Polling,
  Process,
  ProcessGroup,
  ProcessManager,
  type ProcessManagerGroupConfigItem,
  ProcessSchedule,
  ProcessStore,
  QueueResource,
} from "../../../src";
import { utcDateFromMillis } from "../../../src/utcDate";
import { moduleLaunch } from "./launch";
import { analyticsBaseUrl, analyticsPort } from "./ports";

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

const analyticsGroupEndpoints = (): readonly ProcessManagerGroupConfigItem[] => [
  Endpoint.local(
    Endpoint.module(
      () => import("./analytics-runtime.js"),
      (module) => module.AnalyticsRuntime,
      {
        launch: moduleLaunch(
          "examples/scenarios/process-manager-playground/analytics-runtime.ts",
          analyticsBaseUrl,
        ),
      },
    ),
  ).default,
  ProcessManager.Endpoint.production(
    Endpoint.http({
      transport: ProcessManager.Transport.http({ baseUrl: analyticsBaseUrl }),
    }),
  ),
];

export class AnalyticsGroup extends ProcessGroup.Service<AnalyticsGroup>()(
  "@demo/playground/AnalyticsGroup",
  [Sampler, CounterQueue] as const,
  analyticsGroupEndpoints(),
) {}

export const analyticsEnvLayer = Layer.mergeAll(
  AnalyticsGroup.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Sampler.layer.pipe(Layer.provide(CounterQueue.layer)),
        CounterQueue.layer,
        ProcessStore.layer,
      ),
    ),
  ),
  CounterQueue.layer,
  ProcessStore.layer,
);

export const AnalyticsRuntime = ProcessManager.LocalRuntime(AnalyticsGroup, {
  layer: analyticsEnvLayer,
  control: ControlService.layerHttp(AnalyticsGroup, { port: analyticsPort }),
});
