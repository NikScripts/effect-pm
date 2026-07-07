import { Context, Duration, Effect, Layer } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";
import * as Process from "../src/Process";
import { Polling } from "../src/Polling";
// The engine-serve gap: Resource.serve is query-only (no worker/tick engine). QueueResource.serve /
// Process.serve must RUN the engine AND preserve R so a per-resource Layer.provide isolates the
// dependency. Proof: two processes whose TICK reads the same Dep tag with different values; each engine
// must actually fire, and each must see its own value.

const observed: Array<string> = [];

class Dep extends Context.Service<Dep, string>()(
  "@nikscripts/effect-pm/test/engine-serve.test/Dep",
) {}
class Recorder extends Context.Service<Recorder, (dep: string) => Effect.Effect<void>>()(
  "@nikscripts/effect-pm/test/engine-serve.test/Recorder",
) {}
const recorderLayer = Layer.succeed(Recorder, (dep) =>
  Effect.sync(() => {
    observed.push(dep);
  }),
);

class ProcA extends Process.Tag<ProcA>()("engine-serve/ProcA") {}
class ProcB extends Process.Tag<ProcB>()("engine-serve/ProcB") {}

// one tick body — reads its Dep and records it. R = Dep | Recorder.
const tick = Effect.gen(function* () {
  const dep = yield* Dep;
  const record = yield* Recorder;
  yield* record(dep);
});
const cfg = { effect: tick, polling: Polling.spaced(Duration.millis(50)) };

const Node = Resource.httpServer().pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Process.serve(ProcA, cfg).pipe(Layer.provide(Layer.succeed(Dep, "depA"))),
      Process.serve(ProcB, cfg).pipe(Layer.provide(Layer.succeed(Dep, "depB"))),
    ),
  ),
  Layer.provide(recorderLayer), // Dep discharged per resource; Recorder shared
  Layer.provide(Resource.servedResourcesLayer),
  Layer.provide(NodeHttpServer.layerTest),
);

it("engine-serve runs the tick engine per resource, with the dependency isolated", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(Node)));
      yield* Effect.sleep(Duration.millis(600)); // let both engines tick a few times

      // the ENGINES ran (ticks fired — not just handlers mounted), and each saw ITS OWN Dep:
      expect(observed).toContain("depA");
      expect(observed).toContain("depB");
    }).pipe(Effect.scoped),
  ));
