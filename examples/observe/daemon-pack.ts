/**
 * @module examples/observe/daemon-pack
 *
 * Bind `DaemonView.pack` with `Observe.bind` against a local daemon served by a
 * local Node. Skins can consume the same box from React via `Observe.use`.
 *
 * ```bash
 * pnpm run example:observe-daemon-pack
 * ```
 */

// ---cut---
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Schema } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Daemon from "../../src/Daemon";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";
import * as Observe from "../../src/Observe";
import * as DaemonView from "../../src/ui/DaemonView";

class Worker extends Node.Service<Worker>()("examples/ObserveDaemon/Node", {
  path: `/tmp/hyperlink-ts-observe-daemon-${process.pid}.sock`,
}) {}

class Nightly extends Daemon.Service<Nightly>()("examples/ObserveDaemon/Nightly", {
  success: Schema.String,
}).pipe(Hyperlink.andNode(Worker)) {}

const AppLayer = Node.unix(Worker, [
  Daemon.serve(Nightly, {
    effect: Effect.logInfo("nightly body ran").pipe(Effect.as("ok")),
  }),
]).pipe(Layer.provide(NodeServices.layer));

const runtime = Atom.runtime(AppLayer);
const box = Observe.bind(runtime)(Nightly, DaemonView.pack);
const registry = AtomRegistry.make();

const readSuccess = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): A => {
  const value = registry.get(atom);
  if (AsyncResult.isSuccess(value)) return value.value;
  throw new Error(`atom not ready: ${value._tag}`);
};

try {
  const unmountStatus = registry.mount(box.status);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sleep("650 millis");

      const before = readSuccess(box.status);
      yield* Effect.logInfo(`pack id: ${DaemonView.pack.id}`);
      yield* Effect.logInfo(`box keys: ${Object.keys(box).sort().join(", ")}`);
      yield* Effect.logInfo(
        `before run: supervising=${String(before.supervising)} started=${String(
          before.runsStarted,
        )}`,
      );

      registry.set(box.run, undefined as void);
      yield* Effect.sleep("500 millis");

      const after = readSuccess(box.status);
      yield* Effect.logInfo(
        `after run: started=${String(after.runsStarted)} succeeded=${String(
          after.runsSucceeded,
        )}`,
      );

      if (after.runsSucceeded < 1) {
        return yield* Effect.die(new Error("daemon pack did not observe manual run"));
      }
    }).pipe(Effect.tap(() => Effect.logInfo("example:observe-daemon-pack finished OK"))),
  );

  unmountStatus();
} finally {
  registry.dispose();
}
