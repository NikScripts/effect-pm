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
import type { Layout } from "../Layout";
import type * as Route from "../Route";
import * as catalog from "./routes";
import type { Api, ApiConstraint, GroupTop, Match } from "./routes";
import type * as uiRoute from "./route";

// =============================================================================
// Collected registry (transport Layers — ours; Effect registers into HttpRouter)
// =============================================================================

export type PageHandler = {
  readonly page: React.ComponentType<Route.HandleArgs>;
  /** `false` = no layout; omit = use group layout. */
  readonly layout: false | undefined;
};

export type GroupImpl = {
  readonly layout: Layout;
  readonly handlers: ReadonlyMap<string, PageHandler>;
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

type HandleAllEntry = {
  readonly page: React.ComponentType<Route.HandleArgs>;
  readonly options?: HandleOptions | undefined;
} | React.ComponentType<Route.HandleArgs>;

type HandleAllHandlers<
  EndpointsByIdentifier extends Record<string, uiRoute.Constraint>,
> = {
  readonly [Identifier in keyof EndpointsByIdentifier]?: HandleAllEntry;
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

export type HandleOptions = {
  readonly layout?: false | undefined;
};

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
  readonly handlers: Map<string, PageHandler>;

  handle<Identifier extends keyof EndpointsByIdentifier & string>(
    identifier: Identifier & NotHandledIdentifier<Identifier, HandledIdentifiers>,
    page: React.ComponentType<Route.HandleArgs>,
    options?: HandleOptions,
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
    options?: HandleOptions,
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
  page: React.ComponentType<Route.HandleArgs>,
  options?: HandleOptions,
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
  self.handlers.set(identifier, {
    page,
    layout: options?.layout === false ? false : undefined,
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
    page: React.ComponentType<Route.HandleArgs>,
    options?: HandleOptions,
  ) {
    return registerHandler(this, identifier, page, options);
  },
  handleAll(
    this: Handlers<any, any>,
    handlers: Record<string, HandleAllEntry>,
  ) {
    for (const [identifier, entry] of Object.entries(handlers)) {
      if (typeof entry === "function") {
        registerHandler(this, identifier, entry);
      } else {
        registerHandler(this, identifier, entry.page, entry.options);
      }
    }
    return this;
  },
  handleEach(
    this: Handlers<any, any>,
    page: React.ComponentType<Route.HandleArgs>,
    options?: HandleOptions,
  ) {
    for (const id of Object.keys(this.group.routes)) {
      if (!this.handlers.has(id)) {
        registerHandler(this, id, page, options);
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
  self.handlers = new Map<string, PageHandler>();
  return self;
};

// =============================================================================
// group / layer (HttpApiBuilder.group / .layer)
// =============================================================================

type ApiIdOf<A> = A extends Api<infer Id, any> ? Id : string;

/**
 * Implement one catalog group (`HttpApiBuilder.group`).
 * Signature: `(api, id, layout, build)` — layout is UI-only (3rd); handlers last.
 */
export const group = <
  A extends ApiConstraint,
  const Identifier extends keyof A["groups"] & string,
  Return,
>(
  api: A,
  groupIdentifier: Identifier,
  layout: Layout,
  build: (
    handlers: Handlers.FromGroup<A["groups"][Identifier] & GroupTop>,
  ) => Handlers.ValidateReturn<Return>,
): Layer.Layer<
  catalog.Group.Service<ApiIdOf<A>, Identifier>,
  Handlers.Error<Return>,
  Exclude<Handlers.Context<Return>, never>
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
      const impl: GroupImpl = {
        layout,
        handlers: handlers.handlers,
      };
      return Context.makeUnsafe(new Map([[g.key, impl]]));
    }),
  ) as Layer.Layer<
    catalog.Group.Service<ApiIdOf<A>, Identifier>,
    Handlers.Error<Return>,
    Exclude<Handlers.Context<Return>, never>
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
 * Resolve page + layout for a match.
 *
 * @internal
 */
export const resolveRender = (
  bag: {
    readonly groups: ReadonlyMap<string, GroupImpl>;
  },
  match: Match,
): {
  readonly page: React.ComponentType<Route.HandleArgs>;
  readonly layout: Layout | null;
} | null => {
  const impl = bag.groups.get(match.group.identifier);
  if (impl === undefined) return null;
  const h = impl.handlers.get(match.route.identifier);
  if (h === undefined) return null;
  return {
    page: h.page,
    layout: h.layout === false ? null : impl.layout,
  };
};
