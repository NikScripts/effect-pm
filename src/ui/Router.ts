/**
 * @module ui/Router
 *
 * Re-export of `last-ts/Router` plus Hyperlink {@link useTarget}. Prefer
 * `import * as Router from "last-ts/Router"`.
 */
export * from "last-ts/Router";
import { useMatch } from "last-ts/Router";
import { targetOf, type TargetValue } from "./Route";

/**
 * Current {@link ./Route.Target} annotation when the match carries one.
 *
 * @public
 */
export const useTarget = (): TargetValue | undefined => targetOf(useMatch());
