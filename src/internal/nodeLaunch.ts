/**
 * @module internal/nodeLaunch
 *
 * {@link Node.launch} — Layer.launch raced with the listen-exit latch that
 * {@link Node.shutdown} signals (set-and-forget process exit without process.exit).
 */
import { Deferred, Effect, Layer } from "effect";
import type { AnyNode } from "./nodeCore";
import * as listenExit from "./nodeListenExit";

/**
 * Run a listen layer until {@link Node.shutdown} (or scope interrupt).
 *
 * Prefer this over bare `Layer.launch` for nodes that should exit on shutdown.
 * Installs a latch keyed by `node.key` that status `shutdown` signals after
 * membership leave.
 *
 * @category layers & serving
 * @public
 */
export const launch = <E, R>(
  node: AnyNode,
  layer: Layer.Layer<never, E, R>,
): Effect.Effect<void, E, R> =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    yield* listenExit.install(node.key, gate);
    yield* Effect.addFinalizer(() => listenExit.uninstall(node.key));
    yield* Effect.raceFirst(
      Layer.launch(layer),
      Deferred.await(gate),
    );
  }).pipe(Effect.scoped, Effect.asVoid);
