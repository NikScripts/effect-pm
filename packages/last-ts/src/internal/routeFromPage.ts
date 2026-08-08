/**
 * Merge a {@link ../Page} class into a {@link ./route.get} destination —
 * options bag + static Literals → {@link ./routeFromEffect.staticFromEffect}.
 */
import { Effect } from "effect";
import * as Page from "../Page";
import type { Path } from "./route";
import * as route from "./route";
import * as fromEffect from "./routeFromEffect";

/**
 * Build a catalog route from a page class (file-router / catalog merge).
 *
 * - Copies {@link Page.optionsOf} into {@link route.get}
 * - When {@link Page.modeOf} is `"static"` and params are closed Literals,
 *   attaches {@link fromEffect.staticFromEffect} bags automatically
 *
 * ```ts
 * class Chapter extends Page.static({
 *   params: { slug: Schema.Literals(["routing", "view-service"]) },
 * }) {}
 *
 * Router.make("site").add(
 *   Route.fromPage("chapter", "/guides/:slug", Chapter),
 * )
 * ```
 *
 * @public
 */
export const fromPage = <
  const Id extends string,
  const PathType extends Path,
  P extends Page.AnyPage,
>(
  identifier: Id,
  path: PathType,
  page: P,
) => {
  const base = route.get(identifier, path, page.options);
  if (page.mode !== "static") return base;
  const bags = Page.paramBagsOf(page);
  if (bags === undefined) return base;
  return fromEffect.staticFromEffect(base, Effect.succeed(bags));
};
