/**
 * {@link ../RouterBuilder} — HttpApiBuilder analogue for UI catalogs.
 *
 * Structure mirrors `effect/unstable/httpapi/HttpApiBuilder`: `Handlers` builder
 * with `ValidateReturn`, `group` → `Layer.effectContext` under `group.key`,
 * `layer` collects implementations from Context.
 *
 * @internal
 */
import * as React from "react";
import { Context, Effect, Layer, Option } from "effect";
import { type Pipeable, pipeArguments } from "effect/Pipeable";
import * as Layout from "../Layout";
import * as Page from "../Page";
import type * as Route from "../Route";
import * as catalog from "./routes";
import type { Api, ApiConstraint, GroupTop, Match } from "./routes";
import * as pageSuccess from "./pageSuccess";
import type * as uiRoute from "./route";

// =============================================================================
// Collected registry (transport Layers — ours; Effect registers into HttpRouter)
// =============================================================================

/** @deprecated Use {@link HandlerRuntime} */
export type PageHandler = {
  readonly page: React.ComponentType<Route.HandleArgs>;
};

/**
 * Per-endpoint handler runtime.
 *
 * Page: component (legacy props), JSX element, or Effect → ReactNode.
 * Api: Effect HttpApi handler.
 */
export type HandlerRuntime =
  | {
      readonly _tag: "Page";
      readonly page: React.ComponentType<Route.HandleArgs>;
    }
  | {
      readonly _tag: "PageElement";
      readonly element: React.ReactElement;
    }
  | {
      readonly _tag: "PageEffect";
      readonly effect: Effect.Effect<React.ReactNode, unknown, unknown>;
    }
  | {
      readonly _tag: "Api";
      readonly handler: (
        request: unknown,
      ) => Effect.Effect<unknown, unknown, unknown>;
    };

export type GroupImpl = {
  /** Zero-prop layout (`Layout.make` / Passthrough); set via `Layout.provide`. */
  readonly layout: React.FC;
  readonly handlers: ReadonlyMap<string, HandlerRuntime>;
};

/**
 * Resolved catalog + group implementations for {@link ./router} / Outlet.
 *
 * @public
 */
export class Registry extends Context.Service<
  Registry,
  {
    readonly api: ApiConstraint;
    readonly groups: ReadonlyMap<string, GroupImpl>;
  }
>()("last-ts/RouterBuilder/Registry") {}

/** Catalog value for transport Layers. @public */
export class Catalog extends Context.Service<Catalog, ApiConstraint>()(
  "last-ts/RouterBuilder/Catalog",
) {}

const GROUP_KEY_PREFIX = "last-ts/Router/Group/";

// =============================================================================
// Handlers builder (HttpApiBuilder.Handlers)
// =============================================================================

const HandlersTypeId = "~last-ts/RouterBuilder/Handlers" as const;

type NotHandledIdentifier<
  Identifier extends PropertyKey,
  HandledIdentifiers extends PropertyKey,
> = Identifier extends HandledIdentifiers ? never : unknown;

type HandleAllHandlers<
  EndpointsByIdentifier extends Record<string, uiRoute.Constraint>,
> = {
  readonly [Identifier in keyof EndpointsByIdentifier]?:
    | pageSuccess.HandlerForEndpoint<EndpointsByIdentifier[Identifier]>
    | {
      readonly page: pageSuccess.HandlerForEndpoint<
        EndpointsByIdentifier[Identifier]
      >;
    }
    | {
      readonly handler: pageSuccess.HandlerForEndpoint<
        EndpointsByIdentifier[Identifier]
      >;
    };
};

type HandleAllExtraKeys<
  EndpointsByIdentifier extends Record<string, uiRoute.Constraint>,
  HandlersByIdentifier,
> = {
  readonly [Identifier in Exclude<
    keyof HandlersByIdentifier,
    keyof EndpointsByIdentifier
  >]: never;
};

type HandlersResult<A> = A extends Effect.Effect<infer H, any, any> ? H : A;

type MissingHandlerNames<H extends Handlers<any, any>> = Exclude<
  keyof H["~EndpointsByIdentifier"],
  H["~HandledIdentifiers"]
>;

type ValidateHandlersReturn<
  A,
  H = HandlersResult<A>,
  Missing = H extends Handlers<any, any> ? MissingHandlerNames<H> : never,
> = H extends Handlers<any, any> ? ([Missing] extends [never] ? A
  : `Endpoint not handled: ${Missing & string}`)
  : `Must return the implemented handlers`;

/**
 * Mutable handler collection for one catalog group (`HttpApiBuilder.Handlers`).
 *
 * @public
 */
export interface Handlers<
  EndpointsByIdentifier extends Record<string, uiRoute.Constraint> = {},
  HandledIdentifiers extends keyof EndpointsByIdentifier = never,
> extends Pipeable {
  readonly [HandlersTypeId]: typeof HandlersTypeId;
  readonly "~EndpointsByIdentifier": EndpointsByIdentifier;
  readonly "~HandledIdentifiers": HandledIdentifiers;
  /** @internal */
  readonly group: GroupTop;
  /** @internal */
  readonly handlers: Map<string, HandlerRuntime>;

  /**
   * Page success → React page (`ComponentType` | JSX element | Effect →
   * ReactNode) typed from endpoint params/query; Json/other → Effect handler
   * (`HttpApiEndpoint.Handler` shape).
   */
  handle<Identifier extends keyof EndpointsByIdentifier & string>(
    identifier: Identifier & NotHandledIdentifier<Identifier, HandledIdentifiers>,
    handler: pageSuccess.HandlerForEndpoint<EndpointsByIdentifier[Identifier]>,
  ): Handlers<EndpointsByIdentifier, HandledIdentifiers | Identifier>;

  /**
   * Register remaining endpoints from a partial record (`HttpApiBuilder.handleAll`).
   */
  handleAll<
    const HandlersByIdentifier extends HandleAllHandlers<
      Omit<EndpointsByIdentifier, HandledIdentifiers>
    >,
  >(
    handlers:
      & HandlersByIdentifier
      & HandleAllExtraKeys<
        Omit<EndpointsByIdentifier, HandledIdentifiers>,
        HandlersByIdentifier
      >,
  ): Handlers<
    EndpointsByIdentifier,
    | HandledIdentifiers
    | (keyof HandlersByIdentifier & keyof EndpointsByIdentifier)
  >;

  /**
   * Apply one page to every remaining endpoint (UI convenience — not in HttpApi).
   */
  handleEach(
    page: React.ComponentType<Route.HandleArgs>,
  ): Handlers<EndpointsByIdentifier, keyof EndpointsByIdentifier>;
}

export declare namespace Handlers {
  /** Unimplemented handler bag for a concrete group (`HttpApiBuilder.Handlers.FromGroup`). */
  export type FromGroup<G extends { readonly routes: Record<string, uiRoute.Constraint> }> =
    Handlers<G["routes"]>;

  export type ValidateReturn<A> = ValidateHandlersReturn<A>;

  export type Error<A> = A extends Effect.Effect<any, infer E, any> ? E : never;

  export type Context<A> = A extends Effect.Effect<any, any, infer R> ? R
    : never;
}

/** @deprecated Use {@link Handlers.ValidateReturn} */
export type ValidateComplete<A> = Handlers.ValidateReturn<A>;

/** @deprecated Use {@link Handlers} */
export type HandlersBuilder<
  Endpoints extends Record<string, uiRoute.Constraint>,
  Handled extends keyof Endpoints = never,
> = Handlers<Endpoints, Handled>;

const registerHandler = (
  self: Handlers<any, any>,
  identifier: string,
  handler: unknown,
): Handlers<any, any> => {
  // `group.from(Service)` defers destinations until RouterBuilder.layer — skip
  // the static route-map check (HttpApi has no deferred endpoints).
  const deferred = Context.getOption(self.group.annotations, catalog.FromRoutes);
  if (
    Option.isNone(deferred) &&
    !Object.hasOwn(self.group.routes, identifier)
  ) {
    throw new Error(
      `Route "${identifier}" not found in Router.Group "${self.group.identifier}"`,
    );
  }
  if (self.handlers.has(identifier)) {
    throw new Error(
      `Handler for Route "${identifier}" is already registered in Router.Group "${self.group.identifier}"`,
    );
  }
  const endpoint = self.group.routes[identifier];
  const asPage =
    Option.isSome(deferred) ||
    endpoint === undefined ||
    pageSuccess.isPageEndpoint(endpoint);

  if (!asPage) {
    self.handlers.set(identifier, {
      _tag: "Api",
      handler: handler as (
        request: unknown,
      ) => Effect.Effect<unknown, unknown, unknown>,
    });
    return self;
  }

  // Page mint → unwrap default (component | Effect | JSX)
  if (Page.isPage(handler)) {
    return registerHandler(self, identifier, handler.default);
  }

  if (React.isValidElement(handler)) {
    self.handlers.set(identifier, {
      _tag: "PageElement",
      element: handler,
    });
    return self;
  }

  if (Effect.isEffect(handler)) {
    self.handlers.set(identifier, {
      _tag: "PageEffect",
      effect: handler as Effect.Effect<React.ReactNode, unknown, unknown>,
    });
    return self;
  }

  self.handlers.set(identifier, {
    _tag: "Page",
    page: handler as React.ComponentType<Route.HandleArgs>,
  });
  return self;
};

const HandlersProto = {
  [HandlersTypeId]: HandlersTypeId,
  pipe() {
    // eslint-disable-next-line prefer-rest-params -- pipeArguments(this, arguments)
    return pipeArguments(this, arguments);
  },
  handle(
    this: Handlers<any, any>,
    identifier: string,
    handler: unknown,
  ) {
    return registerHandler(this, identifier, handler);
  },
  handleAll(
    this: Handlers<any, any>,
    handlers: Record<string, unknown>,
  ) {
    for (const [identifier, entry] of Object.entries(handlers)) {
      if (React.isValidElement(entry) || Effect.isEffect(entry)) {
        registerHandler(this, identifier, entry);
      } else if (typeof entry === "function") {
        registerHandler(this, identifier, entry);
      } else if (
        entry !== null &&
        typeof entry === "object" &&
        "page" in entry
      ) {
        const e = entry as {
          readonly page: unknown;
        };
        registerHandler(this, identifier, e.page);
      } else if (
        entry !== null &&
        typeof entry === "object" &&
        "handler" in entry
      ) {
        registerHandler(
          this,
          identifier,
          (entry as { readonly handler: unknown }).handler,
        );
      }
    }
    return this;
  },
  handleEach(
    this: Handlers<any, any>,
    page: React.ComponentType<Route.HandleArgs>,
  ) {
    for (const id of Object.keys(this.group.routes)) {
      if (!this.handlers.has(id)) {
        registerHandler(this, id, page);
      }
    }
    return this;
  },
};

const makeHandlers = <G extends GroupTop>(
  group: G,
): Handlers.FromGroup<G> => {
  const self = Object.create(HandlersProto);
  self.group = group;
  self.handlers = new Map<string, HandlerRuntime>();
  return self;
};

// =============================================================================
// group / layer (HttpApiBuilder.group / .layer)
// =============================================================================

type ApiIdOf<A> = A extends Api<infer Id, any> ? Id : string;

type RouteIsPage<E> = pageSuccess.IsPageEndpoint<E> extends true ? true : false;

type RoutesHavePage<Routes extends Record<string, unknown>> = true extends {
  readonly [K in keyof Routes]: RouteIsPage<Routes[K]>;
}[keyof Routes] ? true
  : false;

/** Empty route map (typical `group.from(Service)`) or any Page route → layout debt. */
type GroupNeedsLayout<G extends { readonly routes: Record<string, unknown> }> =
  [keyof G["routes"]] extends [never] ? true
    : RoutesHavePage<G["routes"]> extends true ? true
    : false;

type GroupLayoutDebt<G extends { readonly routes: Record<string, unknown> }> =
  GroupNeedsLayout<G> extends true ? Layout.Slot : never;

const groupNeedsLayoutRuntime = (g: GroupTop): boolean => {
  const deferred = Context.getOption(g.annotations, catalog.FromRoutes);
  if (Option.isSome(deferred)) return true;
  const routes = Object.values(g.routes);
  if (routes.length === 0) return true;
  return routes.some((endpoint) => pageSuccess.isPageEndpoint(endpoint));
};

/**
 * Implement one catalog group (`HttpApiBuilder.group`).
 * Signature: `(api, id, build)` — page groups leave {@link Layout.Slot} in `R`;
 * fulfill with `pipe(group, Layout.provide(AppShell))`.
 */
export const group = <
  A extends ApiConstraint,
  const Identifier extends keyof A["groups"] & string,
  Return,
>(
  api: A,
  groupIdentifier: Identifier,
  build: (
    // Do not intersect with GroupTop — its `Record<string, …>` routes widen
    // keyof to `string` and breaks ValidateReturn completeness.
    handlers: Handlers.FromGroup<A["groups"][Identifier]>,
  ) => Handlers.ValidateReturn<Return>,
): Layer.Layer<
  catalog.Group.Service<ApiIdOf<A>, Identifier>,
  Handlers.Error<Return>,
  | Exclude<Handlers.Context<Return>, never>
  | GroupLayoutDebt<A["groups"][Identifier]>
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const g = api.groups[groupIdentifier] as GroupTop | undefined;
      if (g === undefined) {
        return yield* Effect.die(
          `RouterBuilder.group: group "${String(groupIdentifier)}" not on catalog "${api.identifier}"`,
        );
      }
      const result = build(makeHandlers(g) as never);
      if (typeof result === "string") {
        return yield* Effect.die(`RouterBuilder.group: ${result}`);
      }
      const handlers: Handlers<any, any> = Effect.isEffect(result)
        ? yield* (result as Effect.Effect<Handlers<any, any>>)
        : (result as Handlers<any, any>);
      const needsLayout = groupNeedsLayoutRuntime(g);
      const layout = needsLayout
        ? yield* Layout.Slot
        : Layout.Passthrough.Component;
      const impl: GroupImpl = {
        layout,
        handlers: handlers.handlers,
      };
      return Context.makeUnsafe(new Map([[g.key, impl]]));
    }),
  ) as unknown as Layer.Layer<
    catalog.Group.Service<ApiIdOf<A>, Identifier>,
    Handlers.Error<Return>,
    | Exclude<Handlers.Context<Return>, never>
    | GroupLayoutDebt<A["groups"][Identifier]>
  >;

/**
 * Register catalog; requires every group Layer (`HttpApiBuilder.layer`).
 * Resolves `group.from(Service)`, then provides {@link Catalog} + {@link Registry}.
 */
export const layer = <
  Id extends string,
  Groups extends catalog.GroupTop,
>(
  api: Api<Id, Groups> | ApiConstraint,
): Layer.Layer<
  Catalog | Registry,
  never,
  catalog.Group.ToService<Id, Groups>
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const resolved = yield* catalog.resolveApi(api);
      const services = yield* Effect.context<never>();
      const availableGroups = Array.from(services.mapUnsafe.keys()).filter(
        (key) => key.startsWith(GROUP_KEY_PREFIX),
      );
      const groups = new Map<string, GroupImpl>();
      for (const g of Object.values(resolved.groups) as Array<GroupTop>) {
        const impl = services.mapUnsafe.get(g.key) as GroupImpl | undefined;
        if (impl === undefined) {
          const available =
            availableGroups.length === 0 ? "none" : availableGroups.join(", ");
          return yield* Effect.die(
            `Router.Group "${g.identifier}" not found (key: "${g.key}"). Did you forget to provide RouterBuilder.group(api, "${g.identifier}", ...)? Available groups: ${available}`,
          );
        }
        for (const id of Object.keys(g.routes)) {
          if (!impl.handlers.has(id)) {
            return yield* Effect.die(
              `RouterBuilder.layer: group "${g.identifier}" missing handler "${id}"`,
            );
          }
        }
        groups.set(g.identifier, impl);
      }
      return Context.make(Catalog, resolved).pipe(
        Context.add(Registry, { api: resolved, groups }),
      );
    }),
  ) as Layer.Layer<
    Catalog | Registry,
    never,
    catalog.Group.ToService<Id, Groups>
  >;

/**
 * Resolve handler + layout for a match (Page / PageElement / PageEffect).
 *
 * @internal
 */
export const resolveHandler = (
  bag: {
    readonly groups: ReadonlyMap<string, GroupImpl>;
  },
  match: Match,
): {
  readonly handler: Exclude<HandlerRuntime, { readonly _tag: "Api" }>;
  readonly layout: React.FC;
} | null => {
  const impl = bag.groups.get(match.group.identifier);
  if (impl === undefined) return null;
  const h = impl.handlers.get(match.route.identifier);
  if (h === undefined || h._tag === "Api") return null;
  return {
    handler: h,
    layout: impl.layout,
  };
};

/**
 * @deprecated Use {@link resolveHandler}.
 * @internal
 */
export const resolveRender = (
  bag: {
    readonly groups: ReadonlyMap<string, GroupImpl>;
  },
  match: Match,
): {
  readonly page: React.ComponentType<Route.HandleArgs>;
  readonly layout: React.FC;
} | null => {
  const resolved = resolveHandler(bag, match);
  if (resolved === null || resolved.handler._tag !== "Page") return null;
  return {
    page: resolved.handler.page,
    layout: resolved.layout,
  };
};
