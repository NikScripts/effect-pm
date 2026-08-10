/**
 * `Router.fileSystem` / `Route.fileRoot` — typed destinations from a path table
 * (usually codegen `paths.gen.ts`). Prefer `group.from(Service)` +
 * {@link layerDestinations} for RouterBuilder catalogs.
 *
 * Page-class merge helpers (`*FromPages`, `pagesByIdFromModules`) were removed —
 * unapproved. See `docs/handoffs/last-ts-api-corrections.md`.
 */
import { Context, Effect, Layer } from "effect";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
} from "./asRoutesBrand";
import * as endpoint from "./route";
import * as pageSuccess from "./pageSuccess";
import * as catalog from "./routes";

const EXT = /\.(tsx|ts|jsx|js)$/;
const GROUP_SEGMENT = /^\(.*\)$/;

/**
 * Vite `import.meta.glob` key → disk filePath (`/guides/[slug]`).
 * Skips `_layout` / `_root` / other `_` segments. Strips organizational
 * `(group)` segments (Waku-style route groups) — `(book)/docs/[chapter]` →
 * `/docs/[chapter]`.
 *
 * @public
 */
export const filePathFromGlobKey = (key: string): string | undefined => {
  const normalized = key.replace(/\\/g, "/");
  const marker = "/pages/";
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) return undefined;
  const rel = normalized.slice(idx + marker.length).replace(EXT, "");
  const rawSegs = rel.split("/").filter((s) => s.length > 0);
  if (rawSegs.length === 0) return "/";
  if (rawSegs.some((s) => s.startsWith("_"))) return undefined;
  const segs = rawSegs.filter((s) => !GROUP_SEGMENT.test(s));
  if (segs[segs.length - 1] === "index") segs.pop();
  return "/" + segs.join("/");
};

export type PathEntry = {
  readonly id: string;
  readonly routePath: string;
};

export type EntryRoute<E extends PathEntry> = endpoint.Constraint &
  pageSuccess.PageEndpointBrand & {
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
 * Effect of Route destinations from a typed file-router table.
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
