/**
 * Brand shared by {@link ../Group.asRoutes} and {@link ./uiRoutes} `fromEffect`
 * (kept tiny to avoid Group ↔ Route import cycles).
 */
import { Context } from "effect";

export const AsRoutesTypeId = "~hyperlink-ts/Group/asRoutes" as const;

/** Structural Group node for dashboard route generation / DashboardRoot. */
export type RouteGroup = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

export type AsRoutesBrand = {
  readonly [AsRoutesTypeId]: { readonly root: RouteGroup };
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
