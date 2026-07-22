/**
 * @module examples/queue-widget/queue-atoms
 *
 * Build the live-read + control atoms for a queue tag, once. Native Effect-4
 * atoms on an `Atom.runtime(layer)`; the layer is the seam (a real local queue
 * now, an RPC-backed client layer later).
 *
 * `stats` is a read atom keyed for refresh; mutations carry the same key, so any
 * command (and, in the demo, each worker completion) refreshes it — event-driven,
 * never polled. When the handle gains `changes: Stream<Snapshot>`, `stats`
 * becomes `runtime.atom(handle.changes)` and it's fully live with no keys at all.
 */

import { Effect } from "effect";
import { Atom, type AtomRegistry, type Reactivity } from "effect/unstable/reactivity";
import type { QueueHandle } from "../../src/QueueHyperlink";

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
  T,
  E,
  EEnqueue,
  QR extends RuntimeServices<R>,
  Self extends RuntimeServices<R>,
>(
  runtime: Atom.AtomRuntime<R, ER>,
  queue: Effect.Effect<QueueHandle<T, E, EEnqueue, QR>, never, Self>,
  reactivityKey: ReadonlyArray<unknown>,
) => {
  const keys = { reactivityKeys: reactivityKey };

  const stats = Atom.withReactivity(reactivityKey)(
    runtime.atom(
      Effect.gen(function* () {
        const handle = yield* queue;
        return {
          size: yield* handle.size,
          sizes: yield* handle.sizes,
          completed: yield* handle.completed,
          isEmpty: yield* handle.isEmpty,
        };
      }),
    ),
  );

  // Every control has the same shape: run a handle method on the resolved queue,
  // keyed so a press refreshes `stats`. (This repetition is exactly what a
  // spec-driven factory erases generically — see `makeHyperlinkAtoms`.)
  type Handle = QueueHandle<T, E, EEnqueue, QR>;
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
  const release = command((handle) => handle.release());

  // Routing targets pending entries by selector (here the item value). No "list
  // pending" read is needed — Effect queues can't enumerate; the caller targets
  // what it knows and the queue matches internally.
  const drop = commandWith((handle, item: T) =>
    handle.drop({ item }, { reason: "ui-drop" }),
  );
  const deadLetter = commandWith((handle, item: T) =>
    handle.deadLetter({ item }, { reason: "ui-deadletter" }),
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
