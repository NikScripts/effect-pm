/**
 * Shared Observe pack / bundle helpers — logs accumulator, node connect, cache seeds.
 * @internal
 */
import { Effect, Stream } from "effect";
import type { Atom } from "effect/unstable/reactivity";
import { connect } from "../Node";
import type { AddressedNode, NodeKey } from "../Node";
import * as LogEntry from "../LogEntry";
import { FRESH_MS, readCache, writeCache } from "./cache";
import { now } from "./now";

/** A captured log line for the log pane. */
export interface LogLine {
  readonly id: number;
  readonly t: number;
  readonly level: string;
  readonly message: string;
}

/** Any reactive runtime that provides dashboard tags. */
export type ObserveRuntime<R = never, ER = never> = Atom.AtomRuntime<R, ER>;

let logId = 0;

export const toLogLine = (l: {
  readonly level: string;
  readonly message: string;
}): LogLine => ({
  id: (logId += 1),
  t: now(),
  level: l.level,
  message: l.message,
});

export const bumpLogIdFrom = (key: string): void => {
  const entry = readCache<LogLine>(key);
  if (entry !== undefined) {
    logId = entry.items.reduce((mx, l) => Math.max(mx, l.id), logId);
  }
};

/**
 * Generic cached accumulator: seed from localStorage (instant paint + skip fresh query),
 * accumulate the live stream, persist.
 */
export const cachedAccumulator = <A, R>(opts: {
  readonly key: string;
  readonly cap: number;
  readonly stream: Stream.Stream<A, never, R>;
  readonly query?: Effect.Effect<ReadonlyArray<A>, never, R>;
}): Stream.Stream<ReadonlyArray<A>, never, R> => {
  const entry = readCache<A>(opts.key);
  const fresh = entry !== undefined && now() - entry.at < FRESH_MS;
  const seed: ReadonlyArray<A> = fresh && entry !== undefined ? entry.items : [];
  const source =
    fresh || opts.query === undefined
      ? opts.stream
      : Stream.concat(Stream.unwrap(Effect.map(opts.query, Stream.fromIterable)), opts.stream);
  return source.pipe(
    Stream.scan(seed, (acc, x) => [...acc, x].slice(-opts.cap)),
    Stream.tap((acc) => Effect.sync(() => writeCache(opts.key, acc))),
  );
};

export const nodeConn = (node: NodeKey<unknown>) =>
  connect(node as AddressedNode<unknown>);

/**
 * Node-scoped service log atom (filter by Hyperlink key).
 */
export const serviceLogsAtom = <R, ER>(
  runtime: ObserveRuntime<R, ER>,
  serviceKey: string,
  node: NodeKey<unknown>,
) => {
  bumpLogIdFrom(`${serviceKey}/logs`);
  return runtime.atom(
    cachedAccumulator({
      key: `${serviceKey}/logs`,
      cap: 300,
      stream: Stream.unwrap(Effect.map(node, (h) => h.logs.stream)).pipe(
        Stream.filter(LogEntry.hasKey(serviceKey)),
        Stream.map(toLogLine),
        Stream.orDie,
      ),
      query: Effect.flatMap(node, (h) => h.logs.query({ limit: 300 })).pipe(
        Effect.map((entries) =>
          entries.filter(LogEntry.hasKey(serviceKey)).map(toLogLine),
        ),
        Effect.orDie,
      ),
    }).pipe(Stream.provide(nodeConn(node))),
  );
};
