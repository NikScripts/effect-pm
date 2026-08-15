// Pure helpers for `{.twoslash include="examples/…"}` — safe under `tsx` (no Vite glob).
// The Vite-backed map lives in `./example-sources.ts` for the site render path.

import * as nodePath from "node:path";

/** Normalize a Vite glob key or author `include=` to repo-relative `examples/…`. */
export const normalizeExampleRel = (pathOrKey: string): string => {
  const unified = pathOrKey.replace(/\\/g, "/");
  const at = unified.lastIndexOf("/examples/");
  if (at >= 0) return unified.slice(at + 1);
  return unified.replace(/^\.?\//, "");
};

/**
 * Rewrite `../../../src` / `../../../src/Foo` → `hyperlink-ts` / `hyperlink-ts/Foo` so the page
 * matches guide import style while Twoslash resolves via `highlight.ts` path maps.
 */
export const rewriteExampleImportsForDocs = (text: string): string =>
  text.replace(
    /from\s+(["'])((?:\.\.\/)+)src(?:\/([^"']*))?\1/g,
    (_m, q: string, _dots: string, sub: string | undefined) =>
      sub !== undefined && sub !== ""
        ? `from ${q}hyperlink-ts/${sub}${q}`
        : `from ${q}hyperlink-ts${q}`,
  );

/**
 * Prepare included example text for a Twoslash fence: package-style `hyperlink-ts` imports,
 * plus `// @filename: examples/…` so remaining relative imports (`examples/shared/…`) resolve.
 * Cut markers stay in the file — Twoslash hides them from the visible page.
 */
export const prepareExampleForTwoslash = (text: string, includeRel: string): string => {
  const rel = normalizeExampleRel(includeRel);
  const rewritten = rewriteExampleImportsForDocs(text);
  return `// @filename: ${rel}\n${rewritten}`;
};

/**
 * Disk read for offline scripts (no Vite). Repo root is the directory that contains `examples/`.
 */
export const loadExampleIncludeFromDisk = (
  repoRoot: string,
  include: string,
  readFile: (abs: string) => string,
): string | undefined => {
  const rel = normalizeExampleRel(include);
  if (!rel.startsWith("examples/")) return undefined;
  if (rel.includes("..")) return undefined;
  try {
    return readFile(nodePath.join(repoRoot, rel));
  } catch {
    return undefined;
  }
};
