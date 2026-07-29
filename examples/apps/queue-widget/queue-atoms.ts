/**
 * @module examples/apps/queue-widget/queue-atoms
 *
 * Build the live-read + control atoms for a queue tag, once. Native Effect-4
 * atoms on an `Atom.runtime(layer)`; the layer is the seam (a real local queue
 * now, an RPC-backed client layer later).
 *
 * Typed against the public {@link WorkPool} handle — the product surface
 * (`yield* MyQueue` hovers as `WorkPool<…>`), not the internal engine handle.
 *
 * `stats` is a read atom keyed for refresh; mutations carry the same key, so any
 * command (and, in the demo, each worker completion) refreshes it — event-driven,
 * never polled. When the handle gains `changes: Stream<Snapshot>`, `stats`
 * becomes `runtime.atom(handle.changes)` and it's fully live with no keys at all.
 */

import { Effect } from "effect";
import { Atom, type AtomRegistry, type Reactivity } from "effect/unstable/reactivity";
import type { WorkPool } from "../../../src/WorkPool";

/** What an atom on this runtime may additionally require (provided by the runtime). */
type RuntimeServices<R> = R | AtomRegistry.AtomRegistry | Reactivity.Reactivity;

export interface QueueStats {
  readonly size: number;
  readonly sizes: {
    readonly high: number;
    readonly normal: number;
    readonly low: number;
  };
  readonly completed: number;
  readonly isEmpty: boolean;
}

export const makeQueueAtoms = <
  R,
  ER,
  Payload,
  Success,
  Error,
  Requirements extends RuntimeServices<R>,
  Self extends RuntimeServices<R>,
>(
  runtime: Atom.AtomRuntime<R, ER>,
  queue: Effect.Effect<WorkPool<Payload, Success, Error, Requirements>, never, Self>,
  reactivityKey: ReadonlyArray<unknown>,
) => {
  const keys = { reactivityKeys: reactivityKey };

  const stats = Atom.withReactivity(reactivityKey)(
    runtime.atom(
      Effect.gen(function* () {
        const handle = yield* queue;
        const status = yield* handle.status.get;
        return {
          size: yield* handle.size.get,
          sizes: status.sizes,
          completed: status.completed,
          isEmpty: yield* handle.isEmpty.get,
        };
      }),
    ),
  );

  // Every control has the same shape: run a handle method on the resolved queue,
  // keyed so a press refreshes `stats`. (This repetition is exactly what a
  // spec-driven factory erases generically — see `makeHyperlinkAtoms`.)
  type Handle = WorkPool<Payload, Success, Error, Requirements>;
  const command = <A, CR extends RuntimeServices<R>>(
    run: (handle: Handle) => Effect.Effect<A, never, CR>,
  ) => runtime.fn(() => Effect.flatMap(queue, run), keys);
  const commandWith = <Arg, A, CR extends RuntimeServices<R>>(
    run: (handle: Handle, arg: Arg) => Effect.Effect<A, never, CR>,
  ) =>
    runtime.fn(
      (arg: Arg) => Effect.flatMap(queue, (handle) => run(handle, arg)),
      keys,
    );

  const start = command((handle) => handle.start);
  const pause = command((handle) => handle.pause);
  const resume = command((handle) => handle.resume);
  const clear = command((handle) => handle.clear);
  const shutdown = command((handle) => handle.shutdown);
  const release = command((handle) => handle.release({}));

  // Routing targets pending entries by selector (here the item key / text). No
  // "list pending" read is needed — Effect queues can't enumerate; the caller
  // targets what it knows and the queue matches internally.
  const drop = commandWith((handle, key: string) =>
    handle.drop({ selector: { key }, options: { reason: "ui-drop" } }),
  );
  const deadLetter = commandWith((handle, key: string) =>
    handle.deadLetter({
      selector: { key },
      options: { reason: "ui-deadletter" },
    }),
  );

  return {
    stats,
    start,
    pause,
    resume,
    clear,
    shutdown,
    release,
    drop,
    deadLetter,
  };
};
