/**
 * App shell — build one children-only Provider from a Layer (+ optional router install).
 *
 * @internal
 */
import * as React from "react";
import {
  Context,
  Effect,
  Layer as Layer_,
  Option,
  type Layer,
} from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as AtomReact from "../AtomReact";
import * as Document from "../Document";
import * as Router from "../Router";
import * as lastContext from "./lastContext";
import type { Service } from "./router";

// =============================================================================
// Router mount registry (Waku live hooks under Last.provider)
// =============================================================================

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
 * Build a children-only React provider from a fulfilled Layer and/or a {@link ./lastContext}.
 *
 * - `Last.provider(layer)` — Layer → Atom runtime
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
