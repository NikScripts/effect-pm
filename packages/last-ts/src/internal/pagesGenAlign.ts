/**
 * Align Waku `pages.gen.ts` render modes with `Page.make` / `Page.static`.
 *
 * Waku’s fs-router typegen only sees on-disk `getConfig` exports. Apps never
 * write those — `pageConfig()` injects at transform time — so typegen defaults
 * every file page to `render: "static"`. This pass rewrites literal render
 * modes from the page class constructors so committed `pages.gen.ts` stays
 * honest after `waku dev` regen.
 */
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { discover, writeAtomic, type FileRouterServices } from "./fileRouterPaths";

const usesPageMake = /extends\s+Page\.make\s*\(/;
const usesPageStatic = /extends\s+Page\.static\s*\(/;

export type PageRenderMode = "static" | "dynamic";

/** Detect Page class mode from source (make wins over static if both match). */
export const renderModeOfSource = (
  source: string,
): PageRenderMode | undefined => {
  if (usesPageMake.test(source)) return "dynamic";
  if (usesPageStatic.test(source)) return "static";
  return undefined;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rewrite `| { path: '…'; render: 'static'|'dynamic' }` rows from page sources.
 * Leaves `GetConfigResponse<…>` rows untouched.
 */
export const applyRenderModes = (
  pagesGen: string,
  modes: ReadonlyMap<string, PageRenderMode>,
): string => {
  let next = pagesGen;
  for (const [filePath, mode] of modes) {
    const re = new RegExp(
      `(\\|\\s*\\{\\s*path:\\s*'${escapeRegExp(filePath)}'\\s*;\\s*render:\\s*')(?:static|dynamic)('\\s*\\})`,
    );
    next = next.replace(re, `$1${mode}$2`);
  }
  return next;
};

/** Discover page modes under `pagesDir`. */
export const discoverRenderModes = (
  pagesDir: string,
): Effect.Effect<
  ReadonlyMap<string, PageRenderMode>,
  PlatformError,
  FileRouterServices
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const modes = new Map<string, PageRenderMode>();
    for (const entry of yield* discover(pagesDir)) {
      const source = yield* fs.readFileString(entry.absFile);
      const mode = renderModeOfSource(source);
      if (mode !== undefined) modes.set(entry.filePath, mode);
    }
    return modes;
  });

/**
 * Align on-disk `pages.gen.ts` with Page.make / Page.static. Returns whether
 * the file content changed.
 */
export const alignPagesGen = (
  pagesDir: string,
  pagesGenFile: string,
): Effect.Effect<
  { readonly changed: boolean },
  PlatformError,
  FileRouterServices
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(pagesGenFile))) {
      return { changed: false };
    }
    const prev = yield* fs.readFileString(pagesGenFile);
    const modes = yield* discoverRenderModes(pagesDir);
    const next = applyRenderModes(prev, modes);
    if (next === prev) return { changed: false };
    yield* writeAtomic(pagesGenFile, next);
    return { changed: true };
  });
