/**
 * `Router.fileSystem` / `Route.fileRoot` — typed destinations from a path table
 * (usually codegen `paths.gen.ts`).
 */
import { Effect } from "effect";
import type { Path } from "../ui/Route";
import * as Route from "../ui/Route";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
} from "./asRoutesBrand";

export type PathEntry = {
  readonly id: string;
  readonly routePath: string;
};

type EntryRoute<E extends PathEntry> = E["routePath"] extends Path
  ? Route.Endpoint<E["id"], E["routePath"]>
  : Route.Endpoint<E["id"], Path>;

type RoutesOf<Entries extends ReadonlyArray<PathEntry>> = EntryRoute<
  Entries[number]
>;

const destinationsOf = <const Entries extends ReadonlyArray<PathEntry>>(
  entries: Entries,
): ReadonlyArray<RoutesOf<Entries>> =>
  entries.map((entry) =>
    Route.get(entry.id, entry.routePath as Path),
  ) as ReadonlyArray<RoutesOf<Entries>>;

/**
 * Effect of Route destinations from a typed file-router table.
 *
 * ```ts
 * import { fileEntries } from "./paths.gen"
 * Route.group("root", { topLevel: true }).fromEffect(Router.fileSystem(fileEntries))
 * ```
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
 * Named group over {@link fileSystem}. Prefer {@link fileRoot} for the common case.
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
