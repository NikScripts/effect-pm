/**
 * Expand a path template over {@link ./routeFromEffect} literal bags → hrefs.
 */
import { Effect } from "effect";
import * as route from "./route";
import { fromEffectOf, type ParamBag } from "./routeFromEffect";
import type { Constraint } from "./route";

/**
 * Concrete hrefs for SSG when the route has {@link ./routeFromEffect.staticFromEffect}.
 * Empty when missing or dynamic-only.
 *
 * @public
 */
export const expandStaticPaths = (
  self: Constraint,
): Effect.Effect<ReadonlyArray<string>> => {
  const meta = fromEffectOf(self);
  if (meta === undefined || meta.static !== true) {
    return Effect.succeed([]);
  }
  const compiled = route.compilePath(self.path);
  return meta.effect.pipe(
    Effect.map((rows) =>
      rows.map((row: ParamBag) => compiled.build({ ...row })),
    ),
  );
};
