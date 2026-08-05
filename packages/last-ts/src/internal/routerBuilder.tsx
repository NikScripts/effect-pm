/**
 * {@link ../RouterBuilder} — HttpApiBuilder analogue for UI catalogs.
 *
 * @internal
 */
import * as React from "react";
import { Context, Effect, Layer } from "effect";
import type { Layout } from "../Layout";
import type * as Route from "../Route";
import * as catalog from "./routes";
import type { ApiConstraint, GroupTop, Match } from "./routes";
import type * as uiRoute from "./route";

// =============================================================================
// Handler registry
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

/** Collected handlers for {@link layer}. @public */
export class Handlers extends Context.Service<
  Handlers,
  {
    readonly api: ApiConstraint;
    readonly groups: ReadonlyMap<string, GroupImpl>;
  }
>()("last-ts/RouterBuilder/Handlers") {}

/** Catalog value for transport Layers. @public */
export class Catalog extends Context.Service<Catalog, ApiConstraint>()(
  "last-ts/RouterBuilder/Catalog",
) {}

type GroupServiceShape = {
  readonly layout: Layout;
  readonly handlers: ReadonlyMap<string, PageHandler>;
};

const tagCache = new Map<
  string,
  Context.Service<unknown, GroupServiceShape>
>();

const groupServiceKey = (apiId: string, groupId: string): string =>
  `last-ts/RouterBuilder/group/${apiId}/${groupId}`;

/** Stable Context tag per api/group. @internal */
export const groupServiceTag = (
  apiId: string,
  groupId: string,
): Context.Service<unknown, GroupServiceShape> => {
  const key = groupServiceKey(apiId, groupId);
  const cached = tagCache.get(key);
  if (cached !== undefined) return cached;
  const tag = Context.Service<unknown, GroupServiceShape>()(key);
  tagCache.set(key, tag);
  return tag;
};

// =============================================================================
// Handlers builder
// =============================================================================

type EndpointMap = Readonly<Record<string, uiRoute.Constraint>>;

export type HandleOptions = {
  readonly layout?: false | undefined;
};

export type HandlersBuilder<
  Endpoints extends EndpointMap,
  Handled extends keyof Endpoints & string = never,
> = {
  readonly handle: <Id extends Exclude<keyof Endpoints & string, Handled>>(
    id: Id,
    page: React.ComponentType<Route.HandleArgs>,
    options?: HandleOptions,
  ) => HandlersBuilder<Endpoints, Handled | Id>;
  readonly handleAll: (
    page: React.ComponentType<Route.HandleArgs>,
    options?: HandleOptions,
  ) => HandlersBuilder<Endpoints, keyof Endpoints & string>;
  /** @internal */
  readonly _handlers: Map<string, PageHandler>;
};

/** Incomplete handler bag — surfaces missing endpoint ids. @internal */
export type ValidateComplete<
  Endpoints extends EndpointMap,
  Handled extends string,
> = [Exclude<keyof Endpoints & string, Handled>] extends [never]
  ? HandlersBuilder<Endpoints, Handled & keyof Endpoints & string>
  : {
      readonly _error: "RouterBuilder.group: unhandled endpoints";
      readonly missing: Exclude<keyof Endpoints & string, Handled>;
    };

const makeHandlersBuilder = <Endpoints extends EndpointMap>(
  endpoints: Endpoints,
): HandlersBuilder<Endpoints, never> => {
  const handlers = new Map<string, PageHandler>();
  const self: HandlersBuilder<Endpoints, never> = {
    _handlers: handlers,
    handle(id, page, options) {
      handlers.set(id as string, {
        page,
        layout: options?.layout === false ? false : undefined,
      });
      return self as never;
    },
    handleAll(page, options) {
      for (const id of Object.keys(endpoints)) {
        handlers.set(id, {
          page,
          layout: options?.layout === false ? false : undefined,
        });
      }
      return self as never;
    },
  };
  return self;
};

// =============================================================================
// group / layer
// =============================================================================

/**
 * Implement one catalog group (`HttpApiBuilder.group`).
 * Signature: `(api, id, layout, handlers)` — handlers last.
 */
export const group = <
  A extends ApiConstraint,
  const Id extends keyof A["groups"] & string,
  Endpoints extends EndpointMap,
  Handled extends string,
>(
  api: A,
  groupId: Id,
  layout: Layout,
  build: (
    handlers: HandlersBuilder<
      A["groups"][Id] extends { readonly routes: infer R extends EndpointMap }
        ? R
        : Endpoints
    >,
  ) => ValidateComplete<
    A["groups"][Id] extends { readonly routes: infer R extends EndpointMap }
      ? R
      : Endpoints,
    Handled
  >,
): Layer.Layer<never> => {
  const g = api.groups[groupId] as GroupTop | undefined;
  if (g === undefined) {
    throw new Error(
      `RouterBuilder.group: group "${String(groupId)}" not on catalog "${api.identifier}"`,
    );
  }
  const tag = groupServiceTag(api.identifier, String(groupId));
  const endpoints = g.routes as Endpoints;
  const built = build(makeHandlersBuilder(endpoints) as never);
  if (
    typeof built === "object" &&
    built !== null &&
    "_error" in (built as object)
  ) {
    throw new Error(
      `RouterBuilder.group: incomplete handlers for "${String(groupId)}"`,
    );
  }
  const impl: GroupServiceShape = {
    layout,
    handlers: (built as HandlersBuilder<Endpoints, string>)._handlers,
  };
  return Layer.succeed(tag, impl) as Layer.Layer<any>;
};

/**
 * Register catalog; requires every top-level group impl (`HttpApiBuilder.layer`).
 * Resolves `group.from(Service)` destinations, then provides {@link Catalog} +
 * {@link Handlers} for the **resolved** catalog.
 */
export const layer = <A extends ApiConstraint>(
  api: A,
): Layer.Layer<Catalog | Handlers> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const resolved = yield* catalog.resolveApi(api);
      const groups = new Map<string, GroupImpl>();
      for (const g of Object.values(resolved.groups) as Array<GroupTop>) {
        const tag = groupServiceTag(api.identifier, g.identifier);
        const impl = yield* tag;
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
        Context.add(Handlers, { api: resolved, groups }),
      );
    }),
  ) as Layer.Layer<Catalog | Handlers>;

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
