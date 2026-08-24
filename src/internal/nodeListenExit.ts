/**
 * Listen-exit latch registry — {@link Node.launch} races {@link Layer.launch} against a
 * Deferred that {@link Node.shutdown} signals after membership leave.
 *
 * @internal
 */
import { Deferred, Effect } from "effect";

const gates = new Map<string, Deferred.Deferred<void, never>>();

/** Install a latch for `nodeKey` before {@link Node.launch} builds the listen layer. @internal */
export const install = (
  nodeKey: string,
  gate: Deferred.Deferred<void, never>,
): Effect.Effect<void> =>
  Effect.sync(() => {
    gates.set(nodeKey, gate);
  });

/** Drop the latch (launch finalizer). @internal */
export const uninstall = (nodeKey: string): Effect.Effect<void> =>
  Effect.sync(() => {
    gates.delete(nodeKey);
  });

/** Latch installed for this node, if {@link Node.launch} is driving the listen. @internal */
export const get = (
  nodeKey: string,
): Deferred.Deferred<void, never> | undefined => gates.get(nodeKey);

/** Signal listen exit (no-op when no latch). @internal */
export const signal = (nodeKey: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const gate = gates.get(nodeKey);
    if (gate === undefined) return;
    yield* Deferred.succeed(gate, undefined).pipe(Effect.asVoid);
  });
