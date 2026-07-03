/**
 * @module MultiNode
 *
 * Combine a field across **N instances of one resource** — the isomorphic core for multi-node
 * resources (one shape, one instance per node). Pure gather + fold over a **caller-supplied** keyed
 * peer map (`node → service`), so it runs unchanged in the browser (a dashboard), in node/bun (an
 * aggregator), or a CLI. Each node's outcome is captured, so the combine decides how to treat a node
 * that's down — sum the survivors, fail hard, or report "2/3 reporting". The toolkit imposes no policy.
 *
 * This is slice 1 of the multi-node design (see `docs/handoffs/multi-node-instances-decisions.md`): the
 * contract field-kinds (`multiQuery` / `multiStream`) and the serve/peer wiring build on these.
 *
 * @since 1.0.0
 */
import { Cause, Effect, Exit, Stream } from "effect";

/** One node's outcome for a gathered query field — node-attributed success/failure. @since 1.0.0 */
export interface NodeResult<A, E = never> {
  readonly node: string;
  readonly exit: Exit.Exit<A, E>;
}

/** One node's stream for a gathered stream field. @since 1.0.0 */
export interface NodeStream<A, E = never> {
  readonly node: string;
  readonly stream: Stream.Stream<A, E>;
}

/**
 * Gather a query field from every instance in `peers` (keyed by node), each call captured as a
 * {@link NodeResult} — a down node becomes a failed `exit`, never a thrown gather — then `combine`.
 * The combine sees **every** node's outcome, so it owns the down-node policy. @since 1.0.0
 */
export const combineQuery = <Svc, A, E, B>(
  peers: Record<string, Svc>,
  pick: (service: Svc) => Effect.Effect<A, E>,
  combine: (results: ReadonlyArray<NodeResult<A, E>>) => B,
): Effect.Effect<B> =>
  Effect.map(
    Effect.forEach(
      Object.entries(peers),
      ([node, service]) =>
        Effect.map(Effect.exit(pick(service)), (exit): NodeResult<A, E> => ({ node, exit })),
      { concurrency: "unbounded" },
    ),
    combine,
  );

/**
 * Combine a stream field across every instance in `peers`: `transform` receives each node's stream
 * (node-attributed) and produces the combined stream — e.g. {@link Combine.mergeStreams} to interleave
 * them all, or a latest-per-node fold. Pure; the live subscription lifecycle is the caller's. @since 1.0.0
 */
export const combineStream = <Svc, A, E, B, EE>(
  peers: Record<string, Svc>,
  pick: (service: Svc) => Stream.Stream<A, E>,
  transform: (streams: ReadonlyArray<NodeStream<A, E>>) => Stream.Stream<B, EE>,
): Stream.Stream<B, EE> =>
  transform(
    Object.entries(peers).map(([node, service]) => ({ node, stream: pick(service) })),
  );

/** Successful per-node values, dropping the nodes that failed. @since 1.0.0 */
const successes = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): ReadonlyArray<{ readonly node: string; readonly value: A }> =>
  results.flatMap((r) => (Exit.isSuccess(r.exit) ? [{ node: r.node, value: r.exit.value }] : []));

/** The nodes whose gather failed, with their cause. @since 1.0.0 */
const failures = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): ReadonlyArray<{ readonly node: string; readonly cause: Cause.Cause<E> }> =>
  results.flatMap((r) => (Exit.isFailure(r.exit) ? [{ node: r.node, cause: r.exit.cause }] : []));

/**
 * Ready-made combines for {@link combineQuery} / {@link combineStream}. They operate on the
 * **successful** nodes (a down node is skipped); a custom fold can read the full `NodeResult[]`
 * (failures included) and decide otherwise. @since 1.0.0
 */
export const Combine = {
  /** Successful per-node values (`{ node, value }[]`), failures dropped. */
  successes,
  /** The failed nodes (`{ node, cause }[]`). */
  failures,
  /** Sum of the successful numeric values. */
  sum: (results: ReadonlyArray<NodeResult<number, unknown>>): number =>
    successes(results).reduce((n, { value }) => n + value, 0),
  /** Successful values as an array (node order). */
  collect: <A, E>(results: ReadonlyArray<NodeResult<A, E>>): ReadonlyArray<A> =>
    successes(results).map((s) => s.value),
  /** Successful values keyed by node. */
  byNode: <A, E>(results: ReadonlyArray<NodeResult<A, E>>): Record<string, A> =>
    Object.fromEntries(successes(results).map((s) => [s.node, s.value])),
  /** Interleave every node's stream into one (a `transform` for {@link combineStream}). */
  mergeStreams: <A, E>(streams: ReadonlyArray<NodeStream<A, E>>): Stream.Stream<A, E> =>
    streams.reduce<Stream.Stream<A, E>>((acc, s) => Stream.merge(acc, s.stream), Stream.empty),
  /** Interleave every node's stream into one, **tagging** each element with its node — attribution
   *  when following peers (a `transform` for {@link combineStream}). */
  mergeByNode: <A, E>(
    streams: ReadonlyArray<NodeStream<A, E>>,
  ): Stream.Stream<{ readonly node: string; readonly value: A }, E> =>
    streams.reduce<Stream.Stream<{ readonly node: string; readonly value: A }, E>>(
      (acc, s) => Stream.merge(acc, Stream.map(s.stream, (value) => ({ node: s.node, value }))),
      Stream.empty,
    ),
};
