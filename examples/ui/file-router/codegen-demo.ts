/**
 * @module examples/ui/file-router/codegen-demo
 *
 * Show off **typed path unions** from file-router codegen + `Route.fileRoot`.
 *
 * ```bash
 * # regenerate (optional — paths.gen.ts is committed so clone/typecheck works cold)
 * hyp file-router emit \
 *   --pages examples/ui/file-router/fixtures/pages \
 *   --out examples/ui/file-router/paths.gen.ts
 *
 * pnpm run example:ui-file-router-codegen
 * ```
 *
 * Guide: `docs/guides/file-router.md` · type lock: `test/ui-file-router-proto.test-d.ts`
 */
import { Effect } from "effect";
import * as Route from "../../../src/ui/Route";
import {
  fileEntries,
  filePaths,
  routePaths,
  type FilePath,
  type FileRouteId,
  type RoutePath,
} from "./paths.gen";

// =============================================================================
// Closed unions (codegen) — not `string`
// =============================================================================

/** Disk shape (`[param]`). */
export const chapterFile: FilePath = "/docs/[chapter]";
/** Hyperlink Route template (`:param`). */
export const chapterRoute: RoutePath = "/docs/:chapter";
/** UrlBuilder id from the file path. */
export const chapterId: FileRouteId = "docs_chapter";

// =============================================================================
// Catalog from the table → typed urls.*
// =============================================================================

export const site = Route.make("codegenDemo").add(Route.fileRoot(fileEntries));
export const urls = Route.urlBuilder(site);

export const demo = {
  filePaths,
  routePaths,
  entries: fileEntries,
  hrefs: {
    index: urls.index(),
    search: urls.search(),
    chapter: urls.docs_chapter("routing"),
    apiPkg: urls.api_pkg("effect"),
  },
} as const;

// ---cut-after---
const program = Effect.gen(function* () {
  yield* Effect.logInfo("FilePath (disk) members");
  for (const p of filePaths) {
    yield* Effect.logInfo(`  ${p}`);
  }
  yield* Effect.logInfo("RoutePath (Hyperlink) members");
  for (const p of routePaths) {
    yield* Effect.logInfo(`  ${p}`);
  }
  yield* Effect.logInfo("typed urls");
  yield* Effect.logInfo(`  index            ${demo.hrefs.index}`);
  yield* Effect.logInfo(`  search           ${demo.hrefs.search}`);
  yield* Effect.logInfo(`  docs_chapter     ${demo.hrefs.chapter}`);
  yield* Effect.logInfo(`  api_pkg          ${demo.hrefs.apiPkg}`);
  yield* Effect.logInfo(
    `chapterFile ${chapterFile} → chapterRoute ${chapterRoute} (id ${chapterId})`,
  );
});

void Effect.runPromise(
  program.pipe(
    Effect.tap(() =>
      Effect.logInfo("example:ui-file-router-codegen finished OK"),
    ),
  ),
);
