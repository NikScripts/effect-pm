// Precompute twoslash hover HTML for the effect-smol packages' source panels.
//
// The API-reference source panel shows a symbol's declaration WITH type-on-hover. For our own package
// that runs at render time; for effect's ~4000 symbols it would re-typecheck each file once per symbol
// (~0.3s each → ~20 min a build). Instead we twoslash each file ONCE here (whole-file typecheck warms
// every hover), slice each documented symbol's declaration lines out of the result, and write a tiny
// per-symbol `.src.html` sidecar the page injects verbatim. ~1.5 min for every effect package, cached
// in the (gitignored) api-data tree like the rest of the model — regenerated with it.
//
//   tsx scripts/gen-hovers.ts [pkgSlug ...]     (no args = every effect-smol package)

import { createHash } from "node:crypto";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, Exit, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
// Reuse the LIVE render pipeline (dual-preview expand, markdown-rendered JSDoc, api-typelinks) so the
// precomputed effect hovers are identical to our own package's — one renderer, no drift.
import { highlightToHast, loadHighlighter } from "../src/lib/highlight.js";
import { loadSourceLinks, sourceLinksFor } from "../src/lib/api-source-links.js";
import { moduleSummary, packages, symbolDetail } from "../src/lib/api-data.js";
import { hastToHtml } from "../src/lib/hast-html.js";
import { symbolFileKey } from "../src/lib/api-slugs.js";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
// Sidecars live OUTSIDE api-data (which gen-api wipes every run) so the content-hash cache survives:
// a pinned submodule's files never change, so after the first pass every file is skipped.
const hoversDir = nodePath.join(repoRoot, "docs/site/api-hovers");
const cachePath = nodePath.join(hoversDir, "cache.json");

class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

// --- IO through effect/FileSystem (never node:fs) ---
const readJson = <S extends Schema.Top>(
  path: string,
  schema: S
): Effect.Effect<S["Type"] | undefined, never, FileSystem.FileSystem | S["DecodingServices"]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);
  }).pipe(Effect.orElseSucceed(() => undefined));

const writeText = (
  path: string,
  text: string
): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .makeDirectory(nodePath.dirname(path), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path, text)))
  ).pipe(Effect.mapError((cause) => new FileError({ path, cause })));

const readFile = (path: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.orElseSucceed(() => undefined)
  );

// --- HAST helpers (serializer shared with the live render: src/lib/hast-html.ts) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
type Hast = any;
// The text a reader actually SEES on a line — the twoslash popovers are hidden until hover, so exclude
// them; used to content-anchor the declaration's first line against the real source (robust to any
// directive-stripping line offset).
const isPopover = (n: Hast): boolean => {
  const cls = String(n.properties?.class ?? n.properties?.className ?? "");
  return cls.includes("twoslash-popup") || cls.includes("twoslash-completion");
};
const visibleText = (n: Hast): string => {
  if (n.type === "text") return String(n.value);
  if (n.type === "element" && isPopover(n)) return "";
  return (n.children ?? []).map(visibleText).join("");
};

// Two guards on a declaration's hover slice. Lines is only a COARSE pre-filter for spans so
// pathological that even serializing them for the size check is silly (Effect.fn: 4,290 lines of
// scattered overloads, ~100MB rendered); the byte cap on the serialized slice is the guard that
// actually tracks cost — set to today's heaviest shipping sidecar (Channel.catchTag, 4.3MB) so
// nothing that renders now regresses while popup-light long interfaces (Cause, Scope, DateTime)
// stop being skipped for line count alone.
const MAX_HOVER_LINES = 1100;
const MAX_HOVER_BYTES = 4_500_000;

const program = Effect.gen(function* () {
  const wanted = process.argv.slice(2);
  // Only the effect-smol packages: their source lives under repos/ and needs the precompute.
  const pkgs = (yield* packages())
    .filter((p) => p.slug !== "effect-pm")
    .filter((p) => wanted.length === 0 || wanted.includes(p.slug));
  if (pkgs.length === 0) {
    yield* Console.error("no effect packages in api-data — run gen-api first");
    return;
  }

  // Ready the shared highlighter + api-link / doc-link data (the same load the live render does),
  // plus the compiler source-link stack (docgen SourceRenderer over the model's location index).
  yield* Effect.promise(() => loadHighlighter());
  yield* Effect.promise(() => loadSourceLinks());

  // Collect every documented symbol (via the same readers the site uses), grouped by its source file
  // so each file is twoslashed once.
  interface Sym {
    readonly pkg: string;
    readonly moduleSlug: string;
    readonly name: string;
    readonly line: number; // 1-based declaration start
    readonly sourceText: string;
  }
  const byFile = new Map<string, Array<Sym>>();
  for (const pkg of pkgs) {
    for (const module of pkg.modules) {
      const summary = yield* moduleSummary(pkg.slug, module.slug);
      for (const row of summary?.symbols ?? []) {
        const detail = yield* symbolDetail(pkg.slug, module.slug, row.name);
        if (detail === undefined) continue;
        const arr = byFile.get(detail.source.file) ?? [];
        arr.push({
          pkg: pkg.slug,
          moduleSlug: module.slug,
          name: detail.name,
          line: detail.source.line,
          sourceText: detail.sourceText,
        });
        byFile.set(detail.source.file, arr);
      }
    }
  }

  // Content-hash cache: skip a file whose source is byte-identical to last run (its sidecars already
  // exist in hoversDir). A pinned submodule → every file skipped after the first pass.
  // The cache SELF-INVALIDATES when the hover pipeline changes: the version is a hash of the
  // pipeline's own sources, folded into every entry — no more "delete api-hovers/ after editing".
  const pipelineVersion = yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const siteDir = nodePath.join(repoRoot, "docs/site");
    // Directory-driven, so NEW pipeline files invalidate automatically (a hard-coded list
    // missed hast-html.ts the day it was extracted).
    const dirFiles = (dir: string): Effect.Effect<ReadonlyArray<string>, never, never> =>
      fs.readDirectory(nodePath.join(siteDir, dir)).pipe(
        Effect.map((files) => files.filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${dir}/${f}`)),
        Effect.orElseSucceed(() => [])
      );
    const sources = [
      "scripts/gen-hovers.ts",
      ...(yield* dirFiles("src/lib")),
      ...(yield* dirFiles("../docgen/src")),
    ].sort();
    const hasher = createHash("sha1");
    for (const rel of sources) {
      hasher.update(
        yield* fs.readFileString(nodePath.join(siteDir, rel)).pipe(Effect.orElseSucceed(() => ""))
      );
    }
    return hasher.digest("hex").slice(0, 12);
  });
  const cache = (yield* readJson(cachePath, Schema.Record(Schema.String, Schema.String))) ?? {};
  const nextCache: Record<string, string> = {};
  let files = 0;
  let written = 0;
  let missed = 0;
  let skipped = 0;
  for (const [relFile, syms] of byFile) {
    files += 1;
    const fileText = yield* readFile(nodePath.join(repoRoot, relFile));
    if (fileText === undefined) continue;
    const hash = `${pipelineVersion}:${createHash("sha1").update(fileText).digest("hex")}`;
    nextCache[relFile] = hash;
    if (cache[relFile] === hash) {
      skipped += syms.length;
      continue;
    }
    // The cut strips BOTH directive lines from the tokenized code (twoslash removes `@noErrors`
    // but keeps `@filename` without one — token offsets would shift by that line's length), so
    // file-relative link offsets ARE token offsets. Same mechanism as the live source panel.
    const input = ["// @noErrors", `// @filename: ${relFile}`, "// ---cut---", fileText].join("\n");
    // Compiler-resolved token links for the whole file; sliced per symbol below.
    const links = sourceLinksFor(relFile, 1, fileText.split("\n").length);
    // The shared render pipeline — twoslash + dual-preview expand + markdown JSDoc + api-typelinks —
    // exactly what the live render gives our own package.
    const hast: Hast = yield* Effect.try(() =>
      highlightToHast(input, "ts", { twoslash: true, links })
    ).pipe(Effect.orElseSucceed(() => undefined));
    if (hast === undefined) {
      missed += syms.length;
      continue;
    }
    const pre = (hast.children ?? []).find((c: Hast) => c.tagName === "pre");
    const code = (pre?.children ?? []).find((c: Hast) => c.tagName === "code");
    const lineEls: Array<Hast> = (code?.children ?? []).filter(
      (c: Hast) => c.type === "element" && String(c.properties?.class ?? "").includes("line")
    );
    for (const sym of syms) {
      const first = sym.sourceText.split("\n")[0]?.trimEnd() ?? "";
      const n = sym.sourceText.split("\n").length;
      // A handful of symbols (Effect.fn, pipe, …) have overloads scattered across the file, so their
      // declaration span is thousands of lines — twoslashing that with a popover per token explodes to
      // 100+ MB. Skip the sidecar (the page falls back to plain highlight) past a sane line cap.
      if (n > MAX_HOVER_LINES) {
        missed += 1;
        continue;
      }
      // content-anchor: find the line whose visible text matches the declaration's first line, in a
      // small window around the reported line (0-based guess = 1-based source.line).
      let start = -1;
      for (let d = 0; d <= 4 && start < 0; d++) {
        for (const idx of d === 0 ? [sym.line] : [sym.line + d, sym.line - d]) {
          if (idx >= 0 && idx < lineEls.length && visibleText(lineEls[idx]).trimEnd() === first) {
            start = idx;
            break;
          }
        }
      }
      if (start < 0) {
        missed += 1;
        continue;
      }
      const slice = lineEls.slice(start, start + n);
      const preClass = String(pre?.properties?.class ?? "shiki");
      const inner = slice
        .map((l, i) => hastToHtml(l) + (i < slice.length - 1 ? "\n" : ""))
        .join("");
      const html = `<pre class="${preClass.replace(/"/g, "&quot;")}"><code>${inner}</code></pre>`;
      // The real constraint is page weight, not span length: a popup-light 200-line interface
      // serializes small while a generic-dense combinator explodes. Budget = today's heaviest
      // shipping sidecar, so nothing that works now regresses.
      if (html.length > MAX_HOVER_BYTES) {
        missed += 1;
        continue;
      }
      yield* writeText(
        nodePath.join(hoversDir, sym.pkg, sym.moduleSlug, `${symbolFileKey(sym.name)}.src.html`),
        html
      );
      written += 1;
    }
  }
  yield* writeText(cachePath, `${JSON.stringify(nextCache)}\n`);
  yield* Console.log(
    `hovers: ${pkgs.length} pkgs, ${files} files, ${written} written, ${skipped} cached, ${missed} unmatched`
  );
});

const main = program.pipe(
  Effect.tapCause((cause) => Console.error(String(cause))),
  Effect.provide(NodeServices.layer)
);
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
