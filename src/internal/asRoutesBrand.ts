/**
 * Re-export of last-ts asRoutes brand — Group.asRoutes + group.fromEffect share it.
 */
export {
  AsRoutesTypeId,
  isAsRoutesBrand,
  type AsRoutesBrand,
  type AsRoutesEffect,
  type RouteGroup,
} from "last-ts/Route";
/** Type-only phantom — must not be a runtime re-export. */
export type { AsRoutesItems } from "last-ts/Route";
