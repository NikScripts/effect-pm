/**
 * @module AtomReact
 *
 * React binding over Effect's native reactive layer (`effect/unstable/reactivity`) —
 * `AtomRegistry` provider + hooks, plus `Atom.AtomRuntime` context for app layers.
 *
 * Prefer {@link ../Last.provider} so call sites take children only:
 *
 * ```ts
 * import * as Last from "last-ts/Last"
 *
 * export const Provider = Last.provider(appLayer)
 * // <Provider>…</Provider>
 * ```
 *
 * Low-level escape hatch (paramful):
 *
 * ```ts
 * import * as AtomReact from "last-ts/AtomReact"
 *
 * <AtomReact.RegistryProvider>
 *   <AtomReact.RuntimeProvider runtime={Atom.runtime(appLayer)}>
 *     …
 *   </AtomReact.RuntimeProvider>
 * </AtomReact.RegistryProvider>
 * ```
 */
import * as errors from "./internal/errors";
import * as React from "react";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

// =============================================================================
// Atom registry (subscribe / mount)
// =============================================================================

const RegistryContext = React.createContext<AtomRegistry.AtomRegistry | null>(
  null,
);

/**
 * Provide an `AtomRegistry` (a fresh one by default) to the React tree.
 *
 * @public
 */
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
    throw new errors.RegistryProviderMissing();
  }
  return registry;
};

/**
 * Subscribe to an atom; re-renders on change. The registry ref-counts it.
 *
 * @public
 */
export const useAtomValue = <A,>(atom: Atom.Atom<A>): A => {
  const registry = useRegistry();
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
 * @public
 */
export const useAtomSet = <Read, Write>(
  atom: Atom.Writable<Read, Write>,
): ((value: Write) => void) => {
  const registry = useRegistry();
  React.useEffect(() => registry.mount(atom), [registry, atom]);
  return React.useCallback(
    (value: Write) => registry.set(atom, value),
    [registry, atom],
  );
};

/**
 * Mount an atom for the component's lifetime without subscribing for re-renders.
 *
 * @public
 */
export const useAtomMount = <A,>(atom: Atom.Atom<A>): void => {
  const registry = useRegistry();
  React.useEffect(() => registry.mount(atom), [registry, atom]);
};

/**
 * Force-refresh an atom (re-run its effect/stream).
 *
 * @public
 */
export const useAtomRefresh = <A,>(atom: Atom.Atom<A>): (() => void) => {
  const registry = useRegistry();
  return React.useCallback(() => registry.refresh(atom), [registry, atom]);
};

// =============================================================================
// Atom runtime context (app Layer)
// =============================================================================

/**
 * Erased Atom runtime — React context can't be generic over the consumer's `R`.
 *
 * @public
 */
export type AnyRuntime = Atom.AtomRuntime<any, any>;

const RuntimeContext = React.createContext<AnyRuntime | null>(null);

/**
 * Provide the reactive `Atom.runtime(layer)` to the React tree.
 *
 * @public
 */
export const RuntimeProvider = <R, E = never>(props: {
  readonly runtime: Atom.AtomRuntime<R, E>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    RuntimeContext.Provider,
    { value: props.runtime },
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
    throw new errors.RuntimeProviderMissing();
  }
  return rt;
};
