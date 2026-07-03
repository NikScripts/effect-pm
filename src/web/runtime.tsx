/**
 * @module web/runtime
 *
 * Provides the reactive `runtime` (an `Atom.runtime(layer)` over the consumer's tags) to the
 * dashboard tree via context, so deep widgets can build their atom bundles without
 * prop-drilling. `<Dashboard>` sets this up for you; compose it yourself with `RuntimeProvider`.
 *
 * @since 1.0.0
 */
import * as React from "react";
import type { Atom } from "effect/unstable/reactivity";
import {
  type ApiBundle,
  type ApiTag,
  type NodeBundle,
  type NodeRef,
  type ProcessBundle,
  type ProcessTag,
  type QueueBundle,
  type QueueTag,
  apiBundle,
  nodeStatusBundle,
  processBundle,
  queueBundle,
} from "./data";

// The injected runtime's requirement `R` varies per consumer; React context can't be generic,
// so this single seam erases it. `<Dashboard runtime={...} />` keeps the consumer-facing type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRuntime = Atom.AtomRuntime<any, any>;

const RuntimeContext = React.createContext<AnyRuntime | null>(null);

/** Provide the reactive runtime to the dashboard subtree. @since 1.0.0 */
export const RuntimeProvider = (props: {
  readonly runtime: AnyRuntime;
  readonly children: React.ReactNode;
}): React.ReactElement => <RuntimeContext.Provider value={props.runtime}>{props.children}</RuntimeContext.Provider>;

/** The reactive runtime from context (throws if no `RuntimeProvider`/`Dashboard` above). @since 1.0.0 */
export const useRuntime = (): AnyRuntime => {
  const rt = React.useContext(RuntimeContext);
  if (rt === null) throw new Error("useRuntime: wrap the dashboard in <RuntimeProvider> (or use <Dashboard>)");
  return rt;
};

/** Build (memoized per runtime+tag) the atom bundle for a queue tag, using the context runtime. @since 1.0.0 */
export const useQueueBundle = (tag: QueueTag): QueueBundle => queueBundle(useRuntime(), tag);

/** Build (memoized per runtime+tag) the atom bundle for a process tag, using the context runtime. @since 1.0.0 */
export const useProcessBundle = (tag: ProcessTag): ProcessBundle => processBundle(useRuntime(), tag);

/** Build (memoized per runtime+tag) the atom bundle for an API-metrics tag, using the context runtime. @since 1.0.0 */
export const useApiBundle = (tag: ApiTag): ApiBundle => apiBundle(useRuntime(), tag);

/** Build (memoized per runtime+node) the atom bundle for a node's status, using the context runtime. @since 1.0.0 */
export const useNodeBundle = (ref: NodeRef): NodeBundle => nodeStatusBundle(useRuntime(), ref);
