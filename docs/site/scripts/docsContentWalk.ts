// Shared docs-content walk for gen-search / gen-llms / gen-doc-banners.
// Keep roots in sync with `src/lib/content.ts` `import.meta.glob` (Vite) — that glob is the
// runtime SSOT; this is the Node/Effect mirror for offline generators.
//
// Walks recursively so nested books (e.g. `docs/examples/queue/*.md`) are included.
// Skips `legacy/`, `handoffs/`, `plans/`, `site/` by never listing them as roots.

import * as nodePath from "node:path";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";

/** Top-level dirs under `docs/` that are chapters. `""` = allowlisted top-level files only. */
export const DOCS_CONTENT_ROOTS: ReadonlyArray<string> = [
  "",
  "getting-started",
  "services",
  "guides",
  "observe",
  "standards",
  "examples",
];

/** Explicit top-level `.md` files (matches `content.ts` glob — not every file in `docs/`). */
export const DOCS_TOP_LEVEL_FILES: ReadonlyArray<string> = ["index.md", "examples.md"];

export interface DocsChapterFile {
  /** Absolute path to the `.md` file. */
  readonly absPath: string;
  /** Basename without `.md` — site URL is `/docs/<slug>`. */
  readonly slug: string;
  /** Path relative to `docs/`, e.g. `examples/queue/workpool-priority-lanes.md`. */
  readonly relPath: string;
}

const listMarkdownRecursive = (
  fs: FileSystem.FileSystem,
  absDir: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const names = yield* fs.readDirectory(absDir).pipe(Effect.orElseSucceed(() => [] as Array<string>));
    const out: Array<string> = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const abs = nodePath.join(absDir, name);
      const info = yield* fs.stat(abs).pipe(Effect.orElseSucceed(() => undefined));
      if (info?.type === "Directory") {
        out.push(...(yield* listMarkdownRecursive(fs, abs)));
      } else if (name.endsWith(".md")) {
        out.push(abs);
      }
    }
    return out;
  });

/**
 * Every chapter `.md` under the content roots, sorted by relPath.
 * Skips `README.md` (and optionally other non-chapter basenames via `skipSlugs`).
 */
export const listDocsChapterFiles = (
  docsDir: string,
  options?: { readonly skipSlugs?: ReadonlyArray<string> },
): Effect.Effect<ReadonlyArray<DocsChapterFile>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const skip = new Set(options?.skipSlugs ?? ["README"]);
    const files: Array<DocsChapterFile> = [];
    for (const root of DOCS_CONTENT_ROOTS) {
      const paths =
        root === ""
          ? // Allowlist only — `docs/LOGS.md` etc. are not site chapters.
            DOCS_TOP_LEVEL_FILES.map((n) => nodePath.join(docsDir, n))
          : yield* listMarkdownRecursive(fs, nodePath.join(docsDir, root));

      for (const absPath of paths) {
        const relPath = nodePath.relative(docsDir, absPath).split(nodePath.sep).join("/");
        const slug = nodePath.basename(absPath, ".md");
        if (skip.has(slug)) continue;
        files.push({ absPath, slug, relPath });
      }
    }
    // Preserve DOCS_CONTENT_ROOTS reading order; sort within each root by relPath.
    const rootIndex = new Map(DOCS_CONTENT_ROOTS.map((r, i) => [r, i]));
    const rootOf = (rel: string): string => {
      if (!rel.includes("/")) return "";
      const top = rel.slice(0, rel.indexOf("/"));
      return rootIndex.has(top) ? top : "";
    };
    files.sort((a, b) => {
      const ra = rootIndex.get(rootOf(a.relPath)) ?? 99;
      const rb = rootIndex.get(rootOf(b.relPath)) ?? 99;
      return ra !== rb ? ra - rb : a.relPath.localeCompare(b.relPath);
    });
    return files;
  });
