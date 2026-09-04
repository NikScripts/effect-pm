/**
 * @module ui/Route
 *
 * Re-export of `last-ts/Route` plus Hyperlink **Target** helpers for Group
 * dashboards (`Group.asRoutes`). Prefer `import * as Route from "last-ts/Route"`
 * for the catalog; Target stays on this subpath.
 */
import * as Context from "effect/Context";
export * from "last-ts/Route";
import type { Match } from "last-ts/Route";

// =============================================================================
// Target annotation (Group dashboard metadata — hyperlink-only)
// =============================================================================

/**
 * Optional destination metadata from {@link ../Group.asRoutes}.
 * Not required for ordinary route {@link handle} routing.
 *
 * Discriminated by `_tag`. `view` on {@link LeafView} / {@link Health} is the
 * URL path segment (`"logs"` / `"schedule"` / `"health"`) — lowercase on purpose.
 *
 * @public
 */
export type TargetValue =
  | {
      readonly _tag: "Group";
      readonly keys: ReadonlyArray<string>;
      readonly member: unknown;
    }
  | {
      readonly _tag: "Leaf";
      readonly keys: ReadonlyArray<string>;
      readonly member: unknown;
    }
  | {
      readonly _tag: "LeafView";
      readonly keys: ReadonlyArray<string>;
      readonly member: unknown;
      /** Path segment (`logs` / `schedule`). */
      readonly view: string;
    }
  | {
      readonly _tag: "Health";
      readonly keys: ReadonlyArray<string>;
      /** Path segment (`health`) when present. */
      readonly view?: string | undefined;
    };

/**
 * Annotation service for {@link TargetValue} on a matched destination.
 *
 * @public
 */
export class Target extends Context.Service<Target, TargetValue>()(
  "hyperlink-ts/ui/Route/Target",
) {}

/**
 * Read {@link Target} from a match hit (Group dashboards / annotated destinations).
 *
 * @public
 */
export const targetOf = (hit: Match | undefined): TargetValue | undefined =>
  hit === undefined
    ? undefined
    : Context.getOrUndefined(hit.annotations, Target);

/**
 * Path-segment view on a {@link TargetValue} (`logs` / `schedule` / `health`), if any.
 *
 * @public
 */
export const viewOf = (target: TargetValue | undefined): string | undefined => {
  if (target === undefined) return undefined;
  if (target._tag === "LeafView") return target.view;
  if (target._tag === "Health") return target.view;
  return undefined;
};

/**
 * Selected **leaf** member on a {@link TargetValue} (`Leaf` / `LeafView`), or
 * `null` for Group index / Health / missing. Matches GroupNav `selected`.
 *
 * @public
 */
export const memberOf = (target: TargetValue | undefined): unknown | null => {
  if (target === undefined) return null;
  if (target._tag === "Leaf" || target._tag === "LeafView") return target.member;
  return null;
};
