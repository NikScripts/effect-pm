/**
 * @module examples/observe/gate-pack
 *
 * Bind `GateView.pack` with `Observe.bind`, then drive the same Gate through a
 * command atom. The pack stays focused on status; controls can be composed beside it.
 *
 * ```bash
 * pnpm run example:observe-gate-pack
 * ```
 */

// ---cut---
import { Effect, Schema } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Gate from "../../src/Gate";
import * as Hyperlink from "../../src/Hyperlink";
import * as Observe from "../../src/Observe";
import * as GateView from "../../src/ui/GateView";

class DownloadGate extends Gate.Tag<DownloadGate>()("examples/ObserveGate/Download", {
  payload: Schema.String,
  success: Schema.String,
}) {}

const DownloadGateLive = Gate.layer(DownloadGate, {
  concurrency: 1,
  effect: (id: string) =>
    Effect.sleep("25 millis").pipe(
      Effect.andThen(Effect.logInfo(`downloaded ${id}`)),
      Effect.as(`ok:${id}`),
    ),
});

const runtime = Atom.runtime(DownloadGateLive);
const box = Observe.bind(runtime)(DownloadGate, GateView.pack);
const runDownload = Hyperlink.fn(runtime)(DownloadGate, (gate) => gate.run);
const registry = AtomRegistry.make();

const readSuccess = <A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>): A => {
  const value = registry.get(atom);
  if (AsyncResult.isSuccess(value)) return value.value;
  throw new Error(`atom not ready: ${value._tag}`);
};

try {
  const unmountStatus = registry.mount(box.status);
  const unmountRun = registry.mount(runDownload);

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.sleep("80 millis");

      const before = readSuccess(box.status);
      yield* Effect.logInfo(`pack id: ${GateView.pack.id}`);
      yield* Effect.logInfo(`before run: completed=${String(before.completed)}`);

      registry.set(runDownload, "a");
      yield* Effect.sleep("80 millis");
      registry.set(runDownload, "b");
      yield* Effect.sleep("160 millis");

      const after = readSuccess(box.status);
      yield* Effect.logInfo(
        `after run: completed=${String(after.completed)} waiting=${String(
          after.waiting,
        )} inFlight=${String(after.inFlight)}`,
      );

      if (after.completed < 2) {
        return yield* Effect.die(new Error("gate pack did not observe completed runs"));
      }
    }).pipe(Effect.tap(() => Effect.logInfo("example:observe-gate-pack finished OK"))),
  );

  unmountRun();
  unmountStatus();
} finally {
  registry.dispose();
}
