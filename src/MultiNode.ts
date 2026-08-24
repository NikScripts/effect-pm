/**
 * @module MultiNode
 *
 * Combine a field across **N instances of one HyperService** — the isomorphic core for multi-node
 * resources (one shape, one instance per node). Pure gather + fold over a **caller-supplied** keyed
 * peer map (`node → service`), so it runs unchanged in the browser (a dashboard), in node/bun (an
 * aggregator), or a CLI. Each node's outcome is captured, so the combine decides how to treat a node
 * that's down — sum the survivors ({@link combineByNode}), keep every Exit
 * ({@link combineByNodeExit}), fail hard, or report "2/3 reporting". The toolkit imposes no policy.
 *
 * This is slice 1 of the multi-node design (see `docs/handoffs/multi-host-instances-decisions.md`): the
 * contract field-kinds (`multiQuery` / `multiStream`) and the serve/peer wiring build on these.
 *
 */
import { Cause, Effect, Exit, Stream } from "effect";

/**
 * One node's outcome for a gathered query field — node-attributed success/failure.
 *
 * @category models
 * @public
 */
export interface NodeResult<A, E = never> {
  readonly node: string;
  readonly exit: Exit.Exit<A, E>;
}

/**
 * One node's stream for a gathered stream field.
 *
 * @category models
 * @public
 */
export interface NodeStream<A, E = never> {
  readonly node: string;
  readonly stream: Stream.Stream<A, E>;
}

/**
 * Gather a query field from every instance in `peers` (keyed by node), each call captured as a
 * {@link NodeResult} — a down node becomes a failed `exit`, never a thrown gather — then `combine`.
 * The combine sees **every** node's outcome, so it owns the down-node policy.
 *
 * @category combinators
 * @public
 */
export const combineQuery = <Svc, A, E, B>(
  peers: Record<string, Svc>,
  pick: (service: Svc) => Effect.Effect<A, E>,
  combine: (results: ReadonlyArray<NodeResult<A, E>>) => B,
): Effect.Effect<B> =>
  Effect.forEach(
    Object.entries(peers),
    ([node, service]) =>
      Effect.map(Effect.exit(pick(service)), (exit): NodeResult<A, E> => ({ node, exit })),
    { concurrency: "unbounded" },
  ).pipe(Effect.map(combine));

/**
 * Combine a stream field across every instance in `peers`: `transform` receives each node's stream
 * (node-attributed) and produces the combined stream — e.g. {@link mergeNodeStreams} to interleave
 * them all, or a latest-per-node fold. Pure; the live subscription lifecycle is the caller's.
 *
 * @category combinators
 * @public
 */
export const combineStream = <Svc, A, E, B, EE>(
  peers: Record<string, Svc>,
  pick: (service: Svc) => Stream.Stream<A, E>,
  transform: (streams: ReadonlyArray<NodeStream<A, E>>) => Stream.Stream<B, EE>,
): Stream.Stream<B, EE> =>
  transform(
    Object.entries(peers).map(([node, service]) => ({ node, stream: pick(service) })),
  );

// ============================================================================
// Ready-made combines for combineQuery / combineStream. Each operates on the
// **successful** nodes (a down node is skipped); a custom fold can read the full
// NodeResult[] (failures included) and decide otherwise. Flat exports so a browser
// bundle pulls only the combines it uses.
// ============================================================================

/**
 * Successful per-node values, dropping the nodes that failed.
 *
 * @category combinators
 * @public
 */
export const combineSuccesses = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): ReadonlyArray<{ readonly node: string; readonly value: A }> =>
  results.flatMap((r) => (Exit.isSuccess(r.exit) ? [{ node: r.node, value: r.exit.value }] : []));

/**
 * The nodes whose gather failed, with their cause.
 *
 * @category combinators
 * @public
 */
export const combineFailures = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): ReadonlyArray<{ readonly node: string; readonly cause: Cause.Cause<E> }> =>
  results.flatMap((r) => (Exit.isFailure(r.exit) ? [{ node: r.node, cause: r.exit.cause }] : []));

/**
 * Sum of the successful numeric values.
 *
 * @category combinators
 * @public
 */
export const combineSum = (
  results: ReadonlyArray<NodeResult<number, unknown>>,
): number => combineSuccesses(results).reduce((n, { value }) => n + value, 0);

/**
 * Successful values as an array (node order).
 *
 * @category combinators
 * @public
 */
export const combineCollect = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): ReadonlyArray<A> => combineSuccesses(results).map((s) => s.value);

/**
 * Successful values keyed by node.
 *
 * @category combinators
 * @public
 */
export const combineByNode = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): Record<string, A> =>
  Object.fromEntries(combineSuccesses(results).map((s) => [s.node, s.value]));

/**
 * Every peer exit keyed by node — **keeps failures**. Use this when silence would lie (fleet
 * health): map `Exit` → wire (`Reachable` / `Unreachable`) yourself. Contrast
 * {@link combineByNode}, which drops failed peers (fine for optional metric folds).
 *
 * @category combinators
 * @public
 */
export const combineByNodeExit = <A, E>(
  results: ReadonlyArray<NodeResult<A, E>>,
): Record<string, Exit.Exit<A, E>> =>
  Object.fromEntries(results.map((r) => [r.node, r.exit]));

/**
 * Interleave every node's stream into one (a `transform` for {@link combineStream}).
 *
 * @category combinators
 * @public
 */
export const mergeNodeStreams = <A, E>(
  streams: ReadonlyArray<NodeStream<A, E>>,
): Stream.Stream<A, E> =>
  streams.reduce<Stream.Stream<A, E>>((acc, s) => Stream.merge(acc, s.stream), Stream.empty);

/** Interleave every node's stream into one, **tagging** each element with its node — attribution
 *  when following peers (a `transform` for {@link combineStream}). @public
 *
 * @category combinators
 */
export const mergeNodeStreamsByNode = <A, E>(
  streams: ReadonlyArray<NodeStream<A, E>>,
): Stream.Stream<{ readonly node: string; readonly value: A }, E> =>
  streams.reduce<Stream.Stream<{ readonly node: string; readonly value: A }, E>>(
    (acc, s) => Stream.merge(acc, Stream.map(s.stream, (value) => ({ node: s.node, value }))),
    Stream.empty,
  );
