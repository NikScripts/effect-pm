/**
 * App shell — bake Layer (+ optional router install) into one children-only Provider.
 *
 * @internal
 */
import * as React from "react";
import {
  Context,
  Effect,
  Function as Fn,
  Layer as Layer_,
  Option,
  Pipeable,
  type Layer,
} from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as AtomReact from "../AtomReact";
import * as Router from "../Router";
import type { Service } from "./router";

// =============================================================================
// Types
// =============================================================================

type RouterInstall = (children: React.ReactNode) => React.ReactElement;

/**
 * Composed app shell. Read {@link App.Provider} — no runtime / binding props.
 *
 * @public
 */
export interface App extends Pipeable.Pipeable {
  readonly _tag: "Last/App";
  readonly layer: Layer.Layer<any, any, never>;
  /**
   * Optional wrapper installed inside the Atom runtime (Router, Waku, …).
   *
   * @internal
   */
  readonly installRouter: RouterInstall | undefined;
  /**
   * Single React provider — children only; Layer / router already baked in.
   *
   * @public
   */
  readonly Provider: (props: {
    readonly children: React.ReactNode;
  }) => React.ReactElement;
}

// =============================================================================
// Construction
// =============================================================================

const makeProvider = (
  layer: Layer.Layer<any, any, never>,
  installRouter: RouterInstall | undefined,
): App["Provider"] => {
  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => {
    const runtime = React.useMemo(() => Atom.runtime(layer as never), []);
    const body =
      installRouter !== undefined
        ? installRouter(props.children)
        : props.children;
    return React.createElement(
      AtomReact.RegistryProvider,
      null,
      React.createElement(
        AtomReact.RuntimeProvider as never,
        { runtime },
        body,
      ),
    );
  };
  Provider.displayName = "Last.App.Provider";
  return Provider;
};

/** Build an {@link App} from a Layer and optional router install. @internal */
export const make = <R, E = never>(
  layer: Layer.Layer<R, E, never>,
  installRouter?: RouterInstall,
): App => {
  const erased = layer as Layer.Layer<any, any, never>;
  const self: App = {
    ...Pipeable.Prototype,
    _tag: "Last/App",
    layer: erased,
    installRouter,
    Provider: makeProvider(erased, installRouter),
  };
  return self;
};

/**
 * Start an app shell from a fulfilled Layer (`R` discharged).
 *
 * @example
 * ```tsx
 * export const Provider = Last.app(Title.layer).Provider
 * // <Provider>…</Provider>
 * ```
 *
 * @public
 */
export const app = <R, E = never>(
  layer: Layer.Layer<R, E, never>,
): App => make(layer);

/**
 * Bake a lite {@link Router.Service} into the shell (Memory / History).
 *
 * @example
 * ```tsx
 * export const Provider = Last.app(appLayer).pipe(
 *   Last.router(Router.unsafeService(site, "Memory")),
 * ).Provider
 * ```
 *
 * @public
 */
export const router: {
  (service: Service): (self: App) => App;
  (self: App, service: Service): App;
} = Fn.dual(2, (self: App, service: Service): App =>
  make(self.layer, (children) =>
    React.createElement(Router.Provider, { value: service, children }),
  ),
);

/**
 * Install a custom router wrapper (Waku layer uses this).
 *
 * @public
 */
export const withRouterInstall: {
  (install: RouterInstall): (self: App) => App;
  (self: App, install: RouterInstall): App;
} = Fn.dual(2, (self: App, install: RouterInstall): App =>
  make(self.layer, install),
);

/**
 * One-shot: Layer (+ optional lite router) → children-only Provider.
 *
 * @example
 * ```tsx
 * export const Provider = Last.toProvider(Title.layer)
 * export const Provider = Last.toProvider(appLayer, Router.unsafeService(site, "Memory"))
 * ```
 *
 * @public
 */
export const toProvider = <R, E = never>(
  layer: Layer.Layer<R, E, never>,
  service?: Service,
): App["Provider"] =>
  service === undefined
    ? make(layer).Provider
    : make(layer).pipe(router(service)).Provider;

/**
 * Bake a fulfilled Layer into a children-only React provider. Bridges
 * {@link ../Router.Router} from the Atom runtime into {@link ../Router.Provider}
 * when present.
 *
 * @example
 * ```tsx
 * export const provider = Last.provider(
 *   Layer.mergeAll(routes, History.layer),
 * )
 * // <provider>…</provider>
 * ```
 *
 * @public
 */
export const provider = <R, E = never>(
  layer: Layer.Layer<R, E, never>,
): ((props: {
  readonly children: React.ReactNode;
}) => React.ReactElement) => {
  const erased = layer as Layer.Layer<any, any, never>;
  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => {
    const runtime = React.useMemo(() => Atom.runtime(erased as never), []);
    const router = React.useMemo(
      () => readRouterService(erased),
      [],
    );
    const body =
      router !== null
        ? React.createElement(Router.Provider, {
            value: router,
            children: props.children,
          })
        : props.children;
    return React.createElement(
      AtomReact.RegistryProvider,
      null,
      React.createElement(
        AtomReact.RuntimeProvider as never,
        { runtime },
        body,
      ),
    );
  };
  Provider.displayName = "Last.provider";
  return Provider;
};

/** Sync-read {@link Router.Router} from a fulfilled Layer when present. @internal */
const readRouterService = (
  layer: Layer.Layer<any, any, never>,
): Service | null => {
  try {
    return Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const ctx = yield* Layer_.build(layer);
          return Option.getOrNull(Context.getOption(ctx, Router.Router));
        }),
      ),
    );
  } catch {
    return null;
  }
};
