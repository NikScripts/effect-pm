/**
 * @module examples/queue-widget/atom-react
 *
 * A tiny React binding over Effect 4's **native** reactive layer
 * (`effect/unstable/reactivity`) — no external `@effect-atom`, no duplicate
 * `effect`. This is the whole "atom-react" surface we need: a registry provider
 * plus `useSyncExternalStore`-backed hooks. Atoms themselves (runtime, reads,
 * mutations) are plain Effect-4 values defined elsewhere.
 */

import * as React from "react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

const RegistryContext = React.createContext<AtomRegistry.AtomRegistry | null>(
  null,
);

/** Provide an `AtomRegistry` (defaults to a fresh one) to the tree. */
export const RegistryProvider = (props: {
  readonly registry?: AtomRegistry.AtomRegistry;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const registry = React.useMemo(
    () => props.registry ?? AtomRegistry.make(),
    [props.registry],
  );
  return React.createElement(
    RegistryContext.Provider,
    { value: registry },
    props.children,
  );
};

const useRegistry = (): AtomRegistry.AtomRegistry => {
  const registry = React.useContext(RegistryContext);
  if (registry === null) {
    throw new Error("atom-react: render inside <RegistryProvider>");
  }
  return registry;
};

/** Subscribe to an atom; re-renders on change. The registry ref-counts it. */
export const useAtomValue = <A,>(atom: Atom.Atom<A>): A => {
  const registry = useRegistry();
  // Hold the atom MOUNTED for this component's lifetime so a cold stream atom (status /
  // metrics / logs) starts — and forces its runtime layer to build — on render, not only
  // once useSyncExternalStore's subscribe effect happens to run. Without this, opening a
  // detail can leave the graph/logs blank until another mount (e.g. a control button)
  // nudges the runtime. Mirrors useAtomSet.
  React.useEffect(() => registry.mount(atom), [registry, atom]);
  const subscribe = React.useCallback(
    (onChange: () => void) => registry.subscribe(atom, onChange),
    [registry, atom],
  );
  const get = React.useCallback(() => registry.get(atom), [registry, atom]);
  return React.useSyncExternalStore(subscribe, get, get);
};

/** Get a writer for a writable atom (e.g. trigger a mutation `fn` atom). */
export const useAtomSet = <Read, Write>(
  atom: Atom.Writable<Read, Write>,
): ((value: Write) => void) => {
  const registry = useRegistry();
  // Keep the atom MOUNTED while this component is alive — a `runtime.fn` atom only runs
  // its effect when active. Without this, `set` is a no-op (buttons appear dead).
  React.useEffect(() => registry.mount(atom), [registry, atom]);
  return React.useCallback(
    (value: Write) => registry.set(atom, value),
    [registry, atom],
  );
};

/** Force-refresh an atom (re-run its effect/stream). */
export const useAtomRefresh = <A,>(atom: Atom.Atom<A>): (() => void) => {
  const registry = useRegistry();
  return React.useCallback(() => registry.refresh(atom), [registry, atom]);
};
