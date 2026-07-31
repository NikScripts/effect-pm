/**
 * @module examples/ui/file-router/api
 *
 * **Prototype** — Hyperlink-owned file router (not Waku fs-router).
 *
 * Dream compose (not wired into package exports yet):
 *
 * ```ts
 * Route.group("docs").fromEffect(Router.fileSystem("./pages/docs"))
 * Route.fileSystem("root", "/", { topLevel: true, dir: "./pages" })
 * Route.fileRoot()                    // ≡ fileSystem("root", "/", { topLevel: true })
 * Route.fileRoot({ dir: "./pages" })
 * ```
 *
 * Typing: {@link ./paths.gen} is codegen from the fixture tree. Without that
 * emit, `import.meta.glob` keys collapse to `string` — see handoff.
 */
import { Effect } from "effect";
import * as Route from "../../../src/ui/Route";
import {
  AsRoutesTypeId,
  type AsRoutesEffect,
} from "../../../src/internal/asRoutesBrand";
import {
  fileEntries,
  filePaths,
  type FileEntry,
  type FilePath,
  type FileRouteId,
  type RoutePath,
} from "./paths.gen";

export type { FileEntry, FilePath, FileRouteId, RoutePath };
export { fileEntries, filePaths };

export type FileSystemOptions = {
  /** URL prefix applied to discovered route paths (default `""`). */
  readonly base?: string;
  /**
   * When true (root helper), flatten destinations onto the parent UrlBuilder
   * like `Route.group(..., { topLevel: true })`.
   */
  readonly topLevel?: boolean;
  /**
   * Dev = dynamic render hint; build = static + listed paths.
   * Overlay-only for now — not Waku `getConfig`.
   */
  readonly render?: "static" | "dynamic" | "build";
};

export type FileRootOptions = Omit<FileSystemOptions, "topLevel"> & {
  /** Pages directory (codegen input). Prototype uses fixture paths.gen. */
  readonly dir?: string;
};

/** One Endpoint per generated entry — ids + `:param` paths stay literal. */
export type ProtoRoute = {
  [E in FileEntry as E["id"]]: Route.Endpoint<E["id"], E["routePath"]>;
}[FileRouteId];

/** Map a discovered route path through an optional URL base. */
export const withBase = <P extends string>(
  base: string | undefined,
  routePath: P,
): P | `/${string}` => {
  if (base === undefined || base === "" || base === "/") return routePath;
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (routePath === "/") return prefix as `/${string}`;
  return `${prefix}${routePath}` as `/${string}`;
};

/**
 * Build Route destinations from the typed table (runtime). Types come from
 * {@link ProtoRoute} / the AsRoutes brand — same pattern as `Group.asRoutes`.
 */
export const destinationsOf = (): ReadonlyArray<ProtoRoute> =>
  fileEntries.map(
    (entry) => Route.get(entry.id, entry.routePath) as ProtoRoute,
  );

/**
 * `Router.fileSystem` — Effect of Route destinations from a typed path table.
 *
 * Real impl would take `dir` + discover/codegen; this prototype consumes
 * {@link fileEntries} so UrlBuilder ids and path params stay literal.
 */
export const fileSystem = (
  _dir: string,
  _options?: FileSystemOptions,
): AsRoutesEffect<ProtoRoute> => {
  const effect = Effect.sync(() => destinationsOf());
  return Object.assign(effect, {
    [AsRoutesTypeId]: { root: { key: "fileSystem", members: {} } },
  }) as unknown as AsRoutesEffect<ProtoRoute>;
};

/**
 * `Route.fileSystem` — named group wrapping {@link fileSystem}.
 */
export const routeFileSystem = <const Id extends string>(
  id: Id,
  _base: string,
  options?: FileSystemOptions & { readonly dir?: string },
) => {
  const topLevel = options?.topLevel === true;
  const dir = options?.dir ?? "./pages";
  return topLevel
    ? Route.group(id, { topLevel: true }).fromEffect(fileSystem(dir, options))
    : Route.group(id).fromEffect(fileSystem(dir, options));
};

/**
 * `Route.fileRoot` — the common triple: id `"root"`, base `"/"`, `topLevel: true`.
 */
export const fileRoot = (options?: FileRootOptions) =>
  Route.group("root", { topLevel: true }).fromEffect(
    fileSystem(options?.dir ?? "./pages", { ...options, topLevel: true }),
  );

/**
 * Compose proof — same shape apps would write once this lands on Route/Router.
 *
 * ```ts
 * Route.make("app").add(Route.fileRoot({ dir: "./pages" }))
 * // or: Route.group("docs").fromEffect(Router.fileSystem("./pages/docs"))
 * ```
 */
export const protoSite = Route.make("fileRouterProto").add(fileRoot());

export const protoUrls = Route.urlBuilder(protoSite);
