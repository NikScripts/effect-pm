/**
 * @module ui/runtime
 *
 * Shared reactive runtime context for web + TUI. `<Dashboard>` / compose apps provide
 * `Atom.runtime(layer)` here; `Observe.use` / `NodeView.use` read it — no parallel atoms,
 * no runtime baked into {@link ./View.compose}.
 */
import * as React from "react";
import type { Atom } from "effect/unstable/reactivity";

/**
 * Erased Atom runtime — React context can't be generic over the consumer's `R`.
 *
 * @public
 */
export type AnyRuntime = Atom.AtomRuntime<any, any>;

const RuntimeContext = React.createContext<AnyRuntime | null>(null);

/**
 * Provide the reactive runtime to the dashboard / compose subtree.
 *
 * @public
 */
export const RuntimeProvider = <R, E = never>(props: {
  readonly runtime: Atom.AtomRuntime<R, E>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    RuntimeContext.Provider,
    // Context is erased to {@link AnyRuntime}; keep the call-site runtime typed.
    { value: props.runtime as AnyRuntime },
    props.children,
  );

/**
 * Reactive runtime from context (throws if no {@link RuntimeProvider} above).
 *
 * @public
 */
export const useRuntime = (): AnyRuntime => {
  const rt = React.useContext(RuntimeContext);
  if (rt === null) {
    throw new Error(
      "useRuntime: wrap the tree in <RuntimeProvider runtime={…}> (or <Dashboard>)",
    );
  }
  return rt;
};
