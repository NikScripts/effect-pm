/**
 * `Router.fileSystem` / `Route.fileRoot` — typed destinations from a path table
 * (usually codegen `paths.gen.ts`). Prefer `group.from(Service)` +
 * {@link layerDestinations} for RouterBuilder catalogs.
 */
import { Context, Effect, Layer } from "effect";
import type { Path } from "../Route";
import * as Route from "../Route";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
} from "./asRoutesBrand";

export type PathEntry = {
  readonly id: string;
  readonly routePath: string;
};

export type EntryRoute<E extends PathEntry> = Route.Constraint & {
  readonly identifier: E["id"];
  readonly path: E["routePath"] extends Path ? E["routePath"] : Path;
};

export type RoutesOf<Entries extends ReadonlyArray<PathEntry>> = EntryRoute<
  Entries[number]
>;

/** Sync endpoint list from a typed file-router table. */
export const destinationsOf = <const Entries extends ReadonlyArray<PathEntry>>(
  entries: Entries,
): ReadonlyArray<RoutesOf<Entries>> =>
  entries.map(
    (entry) => Route.get(entry.id, entry.routePath as Path) as RoutesOf<Entries>,
  );

/**
 * Effect of Route destinations from a typed file-router table.
 *
 * ```ts
 * import { fileEntries } from "./paths.gen"
 * Route.group("root", { topLevel: true }).fromEffect(Router.fileSystem(fileEntries))
 * ```
 *
 * Prefer {@link layerDestinations} with `group.from(Service)` for builder catalogs.
 */
export const fileSystem = <const Entries extends ReadonlyArray<PathEntry>>(
  entries: Entries,
): AsRoutesEffect<RoutesOf<Entries>> => {
  const effect = Effect.sync(() => destinationsOf(entries));
  return Object.assign(effect, {
    [AsRoutesTypeId]: { root: { key: "fileSystem", members: {} } },
  }) as unknown as AsRoutesEffect<RoutesOf<Entries>>;
};

/**
 * Layer that provides file-router destinations for `group.from(tag)`.
 *
 * ```ts
 * class FileRoutes extends Context.Service<
 *   FileRoutes,
 *   ReadonlyArray<Router.RoutesOf<typeof table>>
 * >()("app/FileRoutes") {}
 *
 * class Site extends Router.make("site").add(
 *   Router.group("root", { topLevel: true }).from(FileRoutes),
 * ) {}
 *
 * const fileRoutes = Router.layerDestinations(FileRoutes, table)
 * ```
 */
export const layerDestinations = <
  I,
  const Entries extends ReadonlyArray<PathEntry>,
>(
  tag: Context.Service<I, ReadonlyArray<RoutesOf<Entries>>>,
  entries: Entries,
): Layer.Layer<I> => Layer.succeed(tag, destinationsOf(entries));

/**
 * Named group over {@link fileSystem}. Prefer {@link fileRoot} for the common case,
 * or `group.from(Service)` + {@link layerDestinations} for RouterBuilder.
 */
export const routeFileSystem = <
  const Id extends string,
  const Entries extends ReadonlyArray<PathEntry>,
>(
  id: Id,
  entries: Entries,
  options?: { readonly topLevel?: boolean },
) => {
  const effect = fileSystem(entries);
  return options?.topLevel === true
    ? Route.group(id, { topLevel: true }).fromEffect(effect)
    : Route.group(id).fromEffect(effect);
};

/**
 * id `"root"`, `topLevel: true` — flatten file destinations onto the UrlBuilder.
 */
export const fileRoot = <const Entries extends ReadonlyArray<PathEntry>>(
  entries: Entries,
) => routeFileSystem("root", entries, { topLevel: true });
