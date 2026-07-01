/**
 * @module MultiHost
 *
 * Combine a field across **N instances of one resource** — the isomorphic core for multi-host
 * resources (one shape, one instance per host). Pure gather + fold over a **caller-supplied** keyed
 * peer map (`host → service`), so it runs unchanged in the browser (a dashboard), in node/bun (an
 * aggregator), or a CLI. Each host's outcome is captured, so the combine decides how to treat a host
 * that's down — sum the survivors, fail hard, or report "2/3 reporting". The toolkit imposes no policy.
 *
 * This is slice 1 of the multi-host design (see `docs/handoffs/multi-host-instances-decisions.md`): the
 * contract field-kinds (`multiQuery` / `multiStream`) and the serve/peer wiring build on these.
 *
 * @since 1.0.0
 */
import { Cause, Effect, Exit, Stream } from "effect";

/** One host's outcome for a gathered query field — host-attributed success/failure. @since 1.0.0 */
export interface HostResult<A, E = never> {
  readonly host: string;
  readonly exit: Exit.Exit<A, E>;
}

/** One host's stream for a gathered stream field. @since 1.0.0 */
export interface HostStream<A, E = never> {
  readonly host: string;
  readonly stream: Stream.Stream<A, E>;
}

/**
 * Gather a query field from every instance in `peers` (keyed by host), each call captured as a
 * {@link HostResult} — a down host becomes a failed `exit`, never a thrown gather — then `combine`.
 * The combine sees **every** host's outcome, so it owns the down-host policy. @since 1.0.0
 */
export const combineQuery = <Svc, A, E, B>(
  peers: Record<string, Svc>,
  pick: (service: Svc) => Effect.Effect<A, E>,
  combine: (results: ReadonlyArray<HostResult<A, E>>) => B,
): Effect.Effect<B> =>
  Effect.map(
    Effect.forEach(
      Object.entries(peers),
      ([host, service]) =>
        Effect.map(Effect.exit(pick(service)), (exit): HostResult<A, E> => ({ host, exit })),
      { concurrency: "unbounded" },
    ),
    combine,
  );

/**
 * Combine a stream field across every instance in `peers`: `transform` receives each host's stream
 * (host-attributed) and produces the combined stream — e.g. {@link Combine.mergeStreams} to interleave
 * them all, or a latest-per-host fold. Pure; the live subscription lifecycle is the caller's. @since 1.0.0
 */
export const combineStream = <Svc, A, E, B, EE>(
  peers: Record<string, Svc>,
  pick: (service: Svc) => Stream.Stream<A, E>,
  transform: (streams: ReadonlyArray<HostStream<A, E>>) => Stream.Stream<B, EE>,
): Stream.Stream<B, EE> =>
  transform(
    Object.entries(peers).map(([host, service]) => ({ host, stream: pick(service) })),
  );

/** Successful per-host values, dropping the hosts that failed. @since 1.0.0 */
const successes = <A, E>(
  results: ReadonlyArray<HostResult<A, E>>,
): ReadonlyArray<{ readonly host: string; readonly value: A }> =>
  results.flatMap((r) => (Exit.isSuccess(r.exit) ? [{ host: r.host, value: r.exit.value }] : []));

/** The hosts whose gather failed, with their cause. @since 1.0.0 */
const failures = <A, E>(
  results: ReadonlyArray<HostResult<A, E>>,
): ReadonlyArray<{ readonly host: string; readonly cause: Cause.Cause<E> }> =>
  results.flatMap((r) => (Exit.isFailure(r.exit) ? [{ host: r.host, cause: r.exit.cause }] : []));

/**
 * Ready-made combines for {@link combineQuery} / {@link combineStream}. They operate on the
 * **successful** hosts (a down host is skipped); a custom fold can read the full `HostResult[]`
 * (failures included) and decide otherwise. @since 1.0.0
 */
export const Combine = {
  /** Successful per-host values (`{ host, value }[]`), failures dropped. */
  successes,
  /** The failed hosts (`{ host, cause }[]`). */
  failures,
  /** Sum of the successful numeric values. */
  sum: (results: ReadonlyArray<HostResult<number, unknown>>): number =>
    successes(results).reduce((n, { value }) => n + value, 0),
  /** Successful values as an array (host order). */
  collect: <A, E>(results: ReadonlyArray<HostResult<A, E>>): ReadonlyArray<A> =>
    successes(results).map((s) => s.value),
  /** Successful values keyed by host. */
  byHost: <A, E>(results: ReadonlyArray<HostResult<A, E>>): Record<string, A> =>
    Object.fromEntries(successes(results).map((s) => [s.host, s.value])),
  /** Interleave every host's stream into one (a `transform` for {@link combineStream}). */
  mergeStreams: <A, E>(streams: ReadonlyArray<HostStream<A, E>>): Stream.Stream<A, E> =>
    streams.reduce<Stream.Stream<A, E>>((acc, s) => Stream.merge(acc, s.stream), Stream.empty),
  /** Interleave every host's stream into one, **tagging** each element with its host — attribution
   *  when following peers (a `transform` for {@link combineStream}). */
  mergeByHost: <A, E>(
    streams: ReadonlyArray<HostStream<A, E>>,
  ): Stream.Stream<{ readonly host: string; readonly value: A }, E> =>
    streams.reduce<Stream.Stream<{ readonly host: string; readonly value: A }, E>>(
      (acc, s) => Stream.merge(acc, Stream.map(s.stream, (value) => ({ host: s.host, value }))),
      Stream.empty,
    ),
};
