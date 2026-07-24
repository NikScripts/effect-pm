/**
 * @module tui/runtime
 *
 * Reactive runtime context for Ink dashboard cells — same seam as `web/runtime`
 * (React context can't be generic over the consumer's `R`).
 *
 */
import * as React from "react";
import type { Atom } from "effect/unstable/reactivity";

/** @internal */
export type AnyRuntime = Atom.AtomRuntime<any, any>;

const RuntimeContext = React.createContext<AnyRuntime | null>(null);

/** Provide the Atom runtime to TUI cells. @public */
export const RuntimeProvider = (props: {
  readonly runtime: AnyRuntime;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <RuntimeContext.Provider value={props.runtime}>{props.children}</RuntimeContext.Provider>
);

/** The Atom runtime from context (throws if no {@link RuntimeProvider} / `<Dashboard>` above). @public */
export const useRuntime = (): AnyRuntime => {
  const runtime = React.useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("TUI Dashboard widgets require <Dashboard runtime={…} />");
  }
  return runtime;
};
