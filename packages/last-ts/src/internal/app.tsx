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
import * as Document from "../Document";
import * as Router from "../Router";
import * as lastContext from "./lastContext";
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
 * Optional mount override keyed by {@link Service._tag} (e.g. Waku registers
 * a live-hook bridge so Layer stubs are not sealed into {@link Router.Provider}).
 *
 * @internal
 */
const routerMounts = new Map<
  Service["_tag"],
  (service: Service, children: React.ReactNode) => React.ReactElement
>();

/**
 * Register a React mount for a router engine tag. Used by {@link ../Waku}
 * so {@link provider} can hydrate live Waku nav without a hard `waku` import
 * on the Last core path.
 *
 * @internal
 */
export const registerRouterMount = (
  tag: Service["_tag"],
  mount: (service: Service, children: React.ReactNode) => React.ReactElement,
): void => {
  routerMounts.set(tag, mount);
};

const defaultRouterMount = (
  service: Service,
  children: React.ReactNode,
): React.ReactElement =>
  React.createElement(Router.Provider, { value: service, children });

const makeLayerProvider = <R, E = never>(
  layer: Layer.Layer<R, E, never>,
  ctxClass?: lastContext.LastContextClass,
): ((props: {
  readonly children: React.ReactNode;
}) => React.ReactElement) => {
  const erased = layer as Layer.Layer<any, any, never>;
  const ContextProvider =
    ctxClass !== undefined
      ? lastContext.makeContextProvider(ctxClass)
      : undefined;
  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => {
    const boot = React.useMemo(() => {
      const ctx = Effect.runSync(
        Effect.scoped(Layer_.build(erased)),
      );
      const router = Option.getOrNull(
        Context.getOption(ctx, Router.Router),
      ) as Service | null;
      const cell = Option.getOrNull(Context.getOption(ctx, Document.Cell));
      const runtime = Atom.runtime(
        Layer_.succeedContext(ctx) as Layer.Layer<any, never, never> as never,
      );
      return { runtime, router, cell, ctx };
    }, []);
    let body: React.ReactNode = props.children;
    if (ContextProvider !== undefined) {
      body = React.createElement(ContextProvider, null, body);
    }
    body =
      boot.router !== null
        ? (routerMounts.get(boot.router._tag) ?? defaultRouterMount)(
            boot.router,
            body,
          )
        : body;
    const cell = boot.cell;
    const withDocument =
      cell !== null
        ? React.createElement(Document.FieldsProvider, {
            cell,
            children: body,
          })
        : body;
    return React.createElement(
      AtomReact.RegistryProvider,
      null,
      React.createElement(
        AtomReact.RuntimeProvider as never,
        { runtime: boot.runtime },
        React.createElement(
          lastContext.EffectContextProvider,
          { context: boot.ctx },
          withDocument,
        ),
      ),
    );
  };
  Provider.displayName = "Last.provider";
  return Provider;
};

/**
 * Bake a fulfilled Layer and/or a {@link ./lastContext} into a children-only
 * React provider.
 *
 * - `Last.provider(layer)` — Layer → Atom runtime (existing)
 * - `Last.provider(Site)` — bridge Effect services → `Last.use` bags
 * - `Last.provider(layer, Site)` — both
 *
 * @public
 */
export const provider: {
  <R, E = never>(
    layer: Layer.Layer<R, E, never>,
  ): (props: { readonly children: React.ReactNode }) => React.ReactElement;
  (
    ctx: lastContext.LastContextClass,
  ): (props: { readonly children: React.ReactNode }) => React.ReactElement;
  <R, E = never>(
    layer: Layer.Layer<R, E, never>,
    ctx: lastContext.LastContextClass,
  ): (props: { readonly children: React.ReactNode }) => React.ReactElement;
} = ((
  first: Layer.Layer<any, any, never> | lastContext.LastContextClass,
  second?: lastContext.LastContextClass,
) => {
  if (lastContext.isContextClass(first)) {
    return lastContext.makeContextProvider(first);
  }
  return makeLayerProvider(
    first as Layer.Layer<any, any, never>,
    second,
  );
}) as typeof provider;
