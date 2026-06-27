/**
 * @module ui/atom-react
 *
 * The shared React binding over Effect's **native** reactive layer
 * (`effect/unstable/reactivity`) — a registry provider plus `useSyncExternalStore`-backed
 * hooks. No external `@effect-atom`. Used by both the `web` and `tui` renderers (Ink is
 * React too); atoms (runtime, reads, streams, commands) are plain Effect values.
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
  // MOUNT the atom as part of the subscription (not a separate effect): `subscribe` alone
  // doesn't activate a cold atom — a stream atom (status / metrics / logs) only starts, and
  // its runtime layer only builds, once `mount` is called. Tying the mount to the
  // useSyncExternalStore subscription means the atom is live exactly while React reads it,
  // so panels populate on open instead of staying blank until something else nudges the
  // runtime.
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const unmount = registry.mount(atom);
      const unsubscribe = registry.subscribe(atom, onChange);
      return () => {
        unsubscribe();
        unmount();
      };
    },
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
  // Keep the atom MOUNTED while alive — a command `fn` atom only runs its effect when
  // active, so without this `set` is a no-op (dead buttons).
  React.useEffect(() => registry.mount(atom), [registry, atom]);
  return React.useCallback((value: Write) => registry.set(atom, value), [registry, atom]);
};

/**
 * Mount an atom for the component's lifetime without subscribing for re-renders — a
 * keep-alive. Mount this at the app root (with a runtime atom) so the runtime layer stays
 * built across navigation; otherwise tearing the last atom down between views disconnects
 * it and the next view's cold streams start blank.
 *
 * @since 1.0.0
 */
export const useAtomMount = <A,>(atom: Atom.Atom<A>): void => {
  const registry = useRegistry();
  React.useEffect(() => registry.mount(atom), [registry, atom]);
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
