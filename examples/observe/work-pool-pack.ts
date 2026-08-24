/**
 * @module examples/observe/work-pool-pack
 *
 * Bind the shipped `WorkPoolView.pack` against a real local WorkPool served by a
 * local Node. This is the non-React form of the dashboard data binding.
 *
 * ```bash
 * pnpm run example:observe-work-pool-pack
 * ```
 */

// ---cut---
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option, Schema } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";
import * as Observe from "../../src/Observe";
import * as WorkPool from "../../src/WorkPool";
import * as WorkPoolView from "../../src/ui/WorkPoolView";

const Job = Schema.Struct({ id: Schema.String });

class Worker extends Node.Service<Worker>()("examples/ObserveWorkPool/Node", {
  path: `/tmp/hyperlink-ts-observe-work-pool-${process.pid}.sock`,
}) {}

class Jobs extends WorkPool.Service<Jobs>()("examples/ObserveWorkPool/Jobs", {
  payload: Job,
}).pipe(Hyperlink.andNode(Worker)) {}

const AppLayer = Node.unix(Worker, [
  WorkPool.serve(Jobs, {
    paused: true,
    concurrency: 1,
    effect: (job) => Effect.logInfo(`processed ${job.id}`),
    refill: {
      onStart: true,
      load: (queue) =>
        queue.add([{ id: "pack-a" }, { id: "pack-b" }]).pipe(Effect.orDie),
    },
  }),
]).pipe(Layer.provide(NodeServices.layer));

const runtime = Atom.runtime(AppLayer);
const box = Observe.bind(runtime)(Jobs, WorkPoolView.pack);
const registry = AtomRegistry.make();

const readSuccess = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): A => {
  const value = registry.get(atom);
  if (AsyncResult.isSuccess(value)) return value.value;
  throw new Error(`atom not ready: ${value._tag}`);
};

try {
  const unmountStatus = registry.mount(box.status);
  const unmountTrend = registry.mount(box.trend);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sleep("180 millis");

      const before = Option.getOrUndefined(readSuccess(box.status));
      yield* Effect.logInfo(`pack id: ${WorkPoolView.pack.id}`);
      yield* Effect.logInfo(`box keys: ${Object.keys(box).sort().join(", ")}`);
      yield* Effect.logInfo(
        `before resume: pending=${String(
          before === undefined
            ? 0
            : before.sizes.high + before.sizes.normal + before.sizes.low,
        )} paused=${String(before?.paused)}`,
      );

      registry.set(box.resume, undefined as void);
      yield* Effect.sleep("500 millis");

      const after = Option.getOrUndefined(readSuccess(box.status));
      const trend = readSuccess(box.trend);
      yield* Effect.logInfo(
        `after resume: completed=${String(after?.completed)} trendSamples=${String(
          trend.length,
        )}`,
      );

      if (before === undefined || after === undefined || after.completed < 2) {
        return yield* Effect.die(new Error("work pool pack did not observe completion"));
      }
    }).pipe(Effect.tap(() => Effect.logInfo("example:observe-work-pool-pack finished OK"))),
  );

  unmountTrend();
  unmountStatus();
} finally {
  registry.dispose();
}
