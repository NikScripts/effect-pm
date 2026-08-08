/**
 * `Router.fileSystem` / `Route.fileRoot` — typed destinations from a path table
 * (usually codegen `paths.gen.ts`). Prefer `group.from(Service)` +
 * {@link layerDestinations} for RouterBuilder catalogs.
 */
import { Context, Effect, Layer } from "effect";
import * as Page from "../Page";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
} from "./asRoutesBrand";
import { toRouteId } from "./fileRouterPaths";
import * as endpoint from "./route";
import { fromPage } from "./routeFromPage";
import * as catalog from "./routes";

const EXT = /\.(tsx|ts|jsx|js)$/;

/**
 * Vite `import.meta.glob` key → disk filePath (`/guides/[slug]`).
 * Skips `_layout` / `_root` / other `_` segments.
 *
 * @public
 */
export const filePathFromGlobKey = (key: string): string | undefined => {
  const normalized = key.replace(/\\/g, "/");
  const marker = "/pages/";
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) return undefined;
  const rel = normalized.slice(idx + marker.length).replace(EXT, "");
  const segs = rel.split("/").filter((s) => s.length > 0);
  if (segs.length === 0) return "/";
  if (segs.some((s) => s.startsWith("_"))) return undefined;
  if (segs[segs.length - 1] === "index") segs.pop();
  return "/" + segs.join("/");
};

/**
 * Collect {@link Page.isPage} default exports from a Vite glob map, keyed by
 * route id (`guides/[slug].tsx` → `guides_slug`).
 *
 * Feed the result of Vite `import.meta.glob` (eager) over the pages tree.
 *
 * @public
 */
export const pagesByIdFromModules = (
  modules: Record<string, unknown>,
): Record<string, Page.AnyPage> => {
  const out: Record<string, Page.AnyPage> = {};
  for (const [key, mod] of Object.entries(modules)) {
    const filePath = filePathFromGlobKey(key);
    if (filePath === undefined) continue;
    const def =
      mod !== null &&
      typeof mod === "object" &&
      "default" in (mod as object)
        ? (mod as { readonly default: unknown }).default
        : mod;
    if (!Page.isPage(def)) continue;
    out[toRouteId(filePath)] = def;
  }
  return out;
};

export type PathEntry = {
  readonly id: string;
  readonly routePath: string;
};

export type EntryRoute<E extends PathEntry> = endpoint.Constraint & {
  readonly identifier: E["id"];
  readonly path: E["routePath"] extends endpoint.Path ? E["routePath"]
    : endpoint.Path;
};

export type RoutesOf<Entries extends ReadonlyArray<PathEntry>> = EntryRoute<
  Entries[number]
>;

/** Sync endpoint list from a typed file-router table. */
export const destinationsOf = <const Entries extends ReadonlyArray<PathEntry>>(
  entries: Entries,
): ReadonlyArray<RoutesOf<Entries>> =>
  entries.map(
    (entry) =>
      endpoint.get(entry.id, entry.routePath as endpoint.Path) as RoutesOf<
        Entries
      >,
  );

/**
 * Like {@link destinationsOf}, but merge {@link Page.AnyPage} classes by id
 * (`Route.fromPage`) when present — options + static Literals bags.
 *
 * ```ts
 * Router.fileSystem(fileEntries) // path-only
 * destinationsFromPages(fileEntries, { docs_chapter: Chapter })
 * ```
 *
 * @public
 */
export const destinationsFromPages = <
  const Entries extends ReadonlyArray<PathEntry>,
>(
  entries: Entries,
  pages: {
    readonly [K in Entries[number]["id"]]?: Page.AnyPage;
  },
): ReadonlyArray<RoutesOf<Entries>> =>
  entries.map((entry) => {
    const page = pages[entry.id as Entries[number]["id"]];
    if (page !== undefined) {
      return fromPage(
        entry.id,
        entry.routePath as endpoint.Path,
        page,
      ) as RoutesOf<Entries>;
    }
    return endpoint.get(
      entry.id,
      entry.routePath as endpoint.Path,
    ) as RoutesOf<Entries>;
  });

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
    ? catalog.group(id, { topLevel: true }).fromEffect(effect)
    : catalog.group(id).fromEffect(effect);
};

/**
 * id `"root"`, `topLevel: true` — flatten file destinations onto the UrlBuilder.
 */
export const fileRoot = <const Entries extends ReadonlyArray<PathEntry>>(
  entries: Entries,
) => routeFileSystem("root", entries, { topLevel: true });
