/**
 * File-router path table — walk `pages/**`, map disk `[param]` → Route `:param`,
 * emit typed `paths.gen.ts` for UrlBuilder / fileSystem.
 *
 * Used by the Vite plugin (watch) and `hyp` `--check` (CI).
 */
import { Data, Effect, Layer } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { NodeFileSystem, NodePath } from "@effect/platform-node";

const EXT = /\.(tsx|ts|jsx|js)$/;
const GROUP_SEGMENT = /^\(.*\)$/;

export type FileEntry = {
  readonly id: string;
  readonly filePath: string;
  readonly routePath: string;
  /** Absolute source file (for loaders). */
  readonly absFile: string;
};

export type EmitOptions = {
  readonly pagesDir: string;
  readonly outFile: string;
};

/** Missing generated module — run emit / Vite plugin. */
export class PathsMissingError extends Data.TaggedError("PathsMissingError")<{
  readonly path: string;
}> {}

/** Generated module out of date vs pages tree. */
export class PathsStaleError extends Data.TaggedError("PathsStaleError")<{
  readonly path: string;
}> {}

/** Node Path + FileSystem for OS-edge sync runners (Vite / hyp). */
export const nodeLayer: Layer.Layer<FileSystem.FileSystem | Path.Path> =
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

export type FileRouterServices = FileSystem.FileSystem | Path.Path;

/** Run a file-router Effect at an OS edge (Vite hooks, scripts). */
export const runSync = <A, E>(
  effect: Effect.Effect<A, E, FileRouterServices>,
): A => Effect.runSync(effect.pipe(Effect.provide(nodeLayer)));

/**
 * Async OS-edge runner — Node FileSystem is async; Vite hooks must use this
 * (not {@link runSync}) for discover/emit/check.
 */
export const runPromise = <A, E>(
  effect: Effect.Effect<A, E, FileRouterServices>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(nodeLayer)));

const walkFiles = (
  abs: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileRouterServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs.readDirectory(abs);
    const out: Array<string> = [];
    for (const name of names) {
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const next = path.join(abs, name);
      const info = yield* fs.stat(next);
      if (info.type === "Directory") {
        out.push(...(yield* walkFiles(next)));
      } else if (EXT.test(name)) {
        out.push(next);
      }
    }
    return out;
  });

/**
 * `[chapter].tsx` under docs → `/docs/[chapter]`.
 *
 * Organizational `(group)` segments (Waku-style route groups) are stripped —
 * they change nothing about the served path, only the on-disk layout, so
 * `(book)/docs/[chapter]` → `/docs/[chapter]`.
 */
export const toFilePath = (
  pagesDir: string,
  absFile: string,
  path: Path.Path,
): string => {
  const rel = path.relative(pagesDir, absFile).replace(/\\/g, "/");
  const noExt = rel.replace(EXT, "");
  const segs = noExt
    .split("/")
    .filter((s) => s.length > 0 && !GROUP_SEGMENT.test(s));
  if (segs[segs.length - 1] === "index") segs.pop();
  return "/" + segs.join("/");
};

/**
 * Disk → Route path template.
 * `[chapter]` → `:chapter`; `[...path]` → `*path` (rest / splat).
 */
export const toRoutePath = (filePath: string): string =>
  filePath
    .replace(/\[\.\.\.(\w+)\]/g, "*$1")
    .replace(/\[(\w+)\?\]/g, ":$1?")
    .replace(/\[(\w+)\]/g, ":$1");

/** `/docs/[chapter]` → `docs_chapter`; `/docs/[...path]` → `docs_path` */
export const toRouteId = (filePath: string): string => {
  if (filePath === "/") return "index";
  return filePath
    .slice(1)
    .replace(/\[\.\.\.(\w+)\]/g, "$1")
    .replace(/\[(\w+)\??\]/g, "$1")
    .replace(/\//g, "_");
};

/** Discover destination files under a pages directory. */
export const discover = (
  pagesDir: string,
): Effect.Effect<ReadonlyArray<FileEntry>, PlatformError, FileRouterServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(pagesDir);
    if (!(yield* fs.exists(root))) return [];
    const seen = new Set<string>();
    const entries: Array<FileEntry> = [];
    for (const absFile of yield* walkFiles(root)) {
      const filePath = toFilePath(root, absFile, path);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      entries.push({
        id: toRouteId(filePath),
        filePath,
        routePath: toRoutePath(filePath),
        absFile,
      });
    }
    return entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
  });

/** Source text for `paths.gen.ts`. */
export const formatPathsModule = (
  entries: ReadonlyArray<FileEntry>,
): string => {
  const filePathUnion =
    entries.length === 0
      ? "never"
      : entries.map((e) => JSON.stringify(e.filePath)).join(" | ");
  const routePathUnion =
    entries.length === 0
      ? "never"
      : entries.map((e) => JSON.stringify(e.routePath)).join(" | ");
  const idUnion =
    entries.length === 0
      ? "never"
      : entries.map((e) => JSON.stringify(e.id)).join(" | ");

  const publicEntries = entries.map(({ id, filePath, routePath }) => ({
    id,
    filePath,
    routePath,
  }));

  return `/**
 * GENERATED by last-ts file router — do not edit.
 */
export const fileEntries = ${JSON.stringify(publicEntries, null, 2)} as const;

export const filePaths = [
${entries.map((e) => `  ${JSON.stringify(e.filePath)},`).join("\n")}
] as const;

export const routePaths = [
${entries.map((e) => `  ${JSON.stringify(e.routePath)},`).join("\n")}
] as const;

export type FilePath = ${filePathUnion};
export type RoutePath = ${routePathUnion};
export type FileRouteId = ${idUnion};
export type FileEntry = (typeof fileEntries)[number];
`;
};

/** Atomic write (temp + rename). */
export const writeAtomic = (
  outFile: string,
  body: string,
): Effect.Effect<void, PlatformError, FileRouterServices> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const abs = path.resolve(outFile);
    yield* fs.makeDirectory(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    yield* fs.writeFileString(tmp, body);
    yield* fs.rename(tmp, abs);
  });

/**
 * Discover + emit. Returns whether the file content changed.
 */
export const emitPaths = (
  options: EmitOptions,
): Effect.Effect<
  { readonly changed: boolean; readonly entries: ReadonlyArray<FileEntry> },
  PlatformError,
  FileRouterServices
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* discover(options.pagesDir);
    const body = formatPathsModule(entries);
    const abs = path.resolve(options.outFile);
    const prev = (yield* fs.exists(abs))
      ? yield* fs.readFileString(abs)
      : undefined;
    if (prev === body) {
      return { changed: false, entries };
    }
    yield* writeAtomic(abs, body);
    return { changed: true, entries };
  });

/**
 * CI / hyp check — fail if emit would change the file.
 */
export const checkPaths = (
  options: EmitOptions,
): Effect.Effect<
  void,
  PathsMissingError | PathsStaleError | PlatformError,
  FileRouterServices
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const entries = yield* discover(options.pagesDir);
    const body = formatPathsModule(entries);
    const abs = path.resolve(options.outFile);
    if (!(yield* fs.exists(abs))) {
      return yield* new PathsMissingError({ path: abs });
    }
    const prev = yield* fs.readFileString(abs);
    if (prev !== body) {
      return yield* new PathsStaleError({ path: abs });
    }
  });
