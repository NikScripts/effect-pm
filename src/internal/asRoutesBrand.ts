/**
 * Brand shared by {@link ../Group.asRoutes} and {@link ./uiRoutes} `fromEffect`
 * (kept tiny to avoid Group ↔ Route import cycles).
 */
import { Context } from "effect";
import type * as Effect from "effect/Effect";

export const AsRoutesTypeId = "~hyperlink-ts/Group/asRoutes" as const;

/** Phantom carrier for type-level route items produced by `asRoutes`. */
export declare const AsRoutesItems: unique symbol;

/** Structural Group node for dashboard route generation / DashboardRoot. */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

export type AsRoutesBrand = {
  readonly [AsRoutesTypeId]: { readonly root: RouteGroup };
};

/**
 * Effect of route destinations, branded with the source Group and phantom
 * {@link AsRoutesItems} so {@link ./uiRoutes} `fromEffect` preserves UrlBuilder types.
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

/**
 * Dashboard Group root stamped by `Route.group(…).fromEffect(Group.asRoutes(…))`.
 * Router reads this — it never accepts a Group tag as a constructor argument.
 */
export class DashboardRoot extends Context.Service<DashboardRoot, RouteGroup>()(
  "hyperlink-ts/internal/asRoutesBrand/DashboardRoot",
) {}
