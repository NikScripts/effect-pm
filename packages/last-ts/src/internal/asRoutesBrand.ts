/**
 * Brand shared by {@link ../Group.asRoutes} and {@link ./uiRoutes} `effect`
 * (kept tiny to avoid Group ↔ Route import cycles).
 */
import type * as Effect from "effect/Effect";

export const AsRoutesTypeId = "~last-ts/Route/asRoutes" as const;

/** Phantom carrier for type-level route items produced by `asRoutes`. */
export declare const AsRoutesItems: unique symbol;

/** Structural Group node for {@link ../Group.asRoutes} generation. */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

export type AsRoutesBrand = {
  readonly [AsRoutesTypeId]: { readonly root: RouteGroup };
};

/**
 * Effect of route destinations, branded with the source Group and phantom
 * {@link AsRoutesItems} so {@link ./uiRoutes} `effect` preserves UrlBuilder types.
 */
export type AsRoutesEffect<Items = never> = Effect.Effect<
  ReadonlyArray<unknown>,
  never,
  never
> &
  AsRoutesBrand & {
    readonly [AsRoutesItems]: Items;
  };

export const isAsRoutesBrand = (u: unknown): u is AsRoutesBrand =>
  typeof u === "object" && u !== null && AsRoutesTypeId in u;
