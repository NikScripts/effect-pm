/**
 * @module web/atom-react
 *
 * A tiny React binding over Effect's **native** reactive layer
 * (`effect/unstable/reactivity`) — a registry provider plus
 * `useSyncExternalStore`-backed hooks. No external `@effect-atom`. Atoms (runtime,
 * reads, streams, commands) are plain Effect values built by {@link makeResourceUI}.
 *
 * @since 1.0.0
 */
import * as React from "react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

const RegistryContext = React.createContext<AtomRegistry.AtomRegistry | null>(null);

/**
 * Provide an `AtomRegistry` (a fresh one by default) to the React tree.
 *
 * @since 1.0.0
 */
export const RegistryProvider = (props: {
  readonly registry?: AtomRegistry.AtomRegistry;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const registry = React.useMemo(
    () => props.registry ?? AtomRegistry.make(),
    [props.registry],
  );
  return React.createElement(RegistryContext.Provider, { value: registry }, props.children);
};

const useRegistry = (): AtomRegistry.AtomRegistry => {
  const registry = React.useContext(RegistryContext);
  if (registry === null) {
    throw new Error("atom-react: render inside <RegistryProvider>");
  }
  return registry;
};

/**
 * Subscribe to an atom; re-renders on change. The registry ref-counts it.
 *
 * @since 1.0.0
 */
export const useAtomValue = <A,>(atom: Atom.Atom<A>): A => {
  const registry = useRegistry();
  const subscribe = React.useCallback(
    (onChange: () => void) => registry.subscribe(atom, onChange),
    [registry, atom],
  );
  const get = React.useCallback(() => registry.get(atom), [registry, atom]);
  return React.useSyncExternalStore(subscribe, get, get);
};

/**
 * Get a writer for a writable atom (e.g. a command `fn` atom).
 *
 * @since 1.0.0
 */
export const useAtomSet = <Read, Write>(
  atom: Atom.Writable<Read, Write>,
): ((value: Write) => void) => {
  const registry = useRegistry();
  return React.useCallback((value: Write) => registry.set(atom, value), [registry, atom]);
};

/**
 * Force-refresh an atom (re-run its effect/stream).
 *
 * @since 1.0.0
 */
export const useAtomRefresh = <A,>(atom: Atom.Atom<A>): (() => void) => {
  const registry = useRegistry();
  return React.useCallback(() => registry.refresh(atom), [registry, atom]);
};
