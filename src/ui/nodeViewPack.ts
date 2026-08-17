/**
 * Node observe surface — NodeRef is not a Hyperlink Tag, so this is bind/use
 * (not `Observe.use`). Same atom fields as the old `nodeStatusBundle`.
 * @internal
 */
import { Effect, Stream } from "effect";
import type { Atom } from "effect/unstable/reactivity";
import type { NodeBundle, NodeRef } from "./data";
import {
  bumpLogIdFrom,
  cachedAccumulator,
  nodeConn,
  toLogLine,
} from "./observeSupport";

const nodeBundleCache = new WeakMap<object, Map<string, NodeBundle>>();

const cacheFor = (
  runtime: object,
): Map<string, NodeBundle> => {
  let m = nodeBundleCache.get(runtime);
  if (m === undefined) {
    m = new Map();
    nodeBundleCache.set(runtime, m);
  }
  return m;
};

/**
 * Build (once per runtime+node) status / logs / health atoms.
 *
 * @public
 */
export const bind =
  <R, ER>(runtime: Atom.AtomRuntime<R, ER>) =>
  (ref: NodeRef): NodeBundle => {
    const cache = cacheFor(runtime);
    const existing = cache.get(ref.id);
    if (existing !== undefined) return existing;
    const logsKey = `${ref.id}/logs`;
    bumpLogIdFrom(logsKey);
    const bundle: NodeBundle = {
      id: ref.id,
      status: runtime.atom(
        // Provide the per-node client at the STREAM level so its scope spans the whole
        // subscription. (Providing it to the producing Effect tore the scoped RPC client
        // down as soon as that effect returned the stream — "all fibers interrupted".)
        Stream.unwrap(Effect.map(ref.node, (h) => h.status.changes)).pipe(
          Stream.provide(nodeConn(ref.node)),
          Stream.orDie,
        ),
      ),
      logs: runtime.atom(
        cachedAccumulator({
          key: logsKey,
          cap: 300,
          stream: Stream.unwrap(Effect.map(ref.node, (h) => h.logs.stream)).pipe(
            Stream.map(toLogLine),
            Stream.orDie,
          ),
          query: Effect.flatMap(ref.node, (h) => h.logs.query({ limit: 300 })).pipe(
            Effect.map((entries) => entries.map(toLogLine)),
            Effect.orDie,
          ),
        }).pipe(
          Stream.provide(nodeConn(ref.node)),
          Stream.orDie,
        ),
      ),
      // Ready-count over time from the status stream — readiness sparkline.
      health: runtime.atom(
        cachedAccumulator({
          key: `${ref.id}/health`,
          cap: 120,
          stream: Stream.unwrap(Effect.map(ref.node, (h) => h.status.changes)).pipe(
            Stream.map((st) => st.services.filter((x) => x.ready).length),
            Stream.orDie,
          ),
        }).pipe(
          Stream.provide(nodeConn(ref.node)),
          Stream.orDie,
        ),
      ),
    };
    cache.set(ref.id, bundle);
    return bundle;
  };
