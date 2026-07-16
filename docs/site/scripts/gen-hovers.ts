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
import { createTransformerFactory, rendererRich } from "@shikijs/twoslash";
import { createHighlighter } from "shiki";
import { createTwoslasher } from "twoslash";
import ts from "typescript";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const dataDir = nodePath.join(repoRoot, "docs/site/api-data");
// Sidecars live OUTSIDE api-data (which gen-api wipes every run) so the content-hash cache survives:
// a pinned submodule's files never change, so after the first pass every file is skipped.
const hoversDir = nodePath.join(repoRoot, "docs/site/api-hovers");
const cachePath = nodePath.join(hoversDir, "cache.json");

class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

// --- the slice of the model this step needs (a symbol's source location + declaration text) ---
const SourceS = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
});
const SymbolS = Schema.Struct({
  name: Schema.String,
  sourceText: Schema.String,
  source: SourceS,
});
const IndexS = Schema.Struct({
  packages: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      modules: Schema.Array(Schema.Struct({ slug: Schema.String })),
    }),
  ),
});
const ModuleSummaryS = Schema.Struct({
  symbols: Schema.Array(Schema.Struct({ name: Schema.String })),
});

// Mirrors src/lib/api-data.ts + scripts/gen-api.ts (kept in sync): a case-insensitively-unique file key.
const symbolFileKey = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower === name) return name;
  const upper = [...name].flatMap((c, i) => (c !== c.toLowerCase() ? [i] : []));
  return `${lower}-${upper.join("-")}`;
};

// --- IO through effect/FileSystem (never node:fs) ---
const readJson = <S extends Schema.Top>(
  path: string,
  schema: S,
): Effect.Effect<S["Type"] | undefined, never, FileSystem.FileSystem | S["DecodingServices"]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));

const writeText = (path: string, text: string): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs
      .makeDirectory(nodePath.dirname(path), { recursive: true })
      .pipe(Effect.andThen(fs.writeFileString(path, text))),
  ).pipe(Effect.mapError((cause) => new FileError({ path, cause })));

const readFile = (path: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(path)).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
  );

// --- HAST helpers (no hast-util-to-html dep — hand-serialize the shiki/twoslash tree) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HAST plumbing
type Hast = any;
const VOID = new Set(["br", "hr", "img", "input", "col", "wbr"]);
const escText = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const toHtml = (n: Hast): string => {
  if (n.type === "text") return escText(String(n.value));
  if (n.type === "root") return (n.children ?? []).map(toHtml).join("");
  if (n.type !== "element") return "";
  const attrs = Object.entries(n.properties ?? {})
    .map(([k, v]) => {
      const name = k === "className" ? "class" : k;
      const val = Array.isArray(v) ? v.join(" ") : String(v);
      return ` ${name}="${escAttr(val)}"`;
    })
    .join("");
  if (VOID.has(n.tagName)) return `<${n.tagName}${attrs}>`;
  return `<${n.tagName}${attrs}>${(n.children ?? []).map(toHtml).join("")}</${n.tagName}>`;
};
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

const compilerOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  types: [],
  allowImportingTsExtensions: true,
  noEmit: true,
};
const THEMES = { light: "github-light", dark: "github-dark" } as const;
const MAX_HOVER_LINES = 160; // above this a declaration's span is pathological — plain-highlight it

const program = Effect.gen(function* () {
  const wanted = process.argv.slice(2);
  const index = yield* readJson(nodePath.join(dataDir, "index.json"), IndexS);
  if (index === undefined) {
    yield* Console.error("no api-data/index.json — run gen-api first");
    return;
  }
  // Only the effect-smol packages: their source lives under repos/ and needs the precompute.
  const pkgs = index.packages
    .filter((p) => p.slug !== "effect-pm")
    .filter((p) => wanted.length === 0 || wanted.includes(p.slug));

  const highlighter = yield* Effect.promise(() =>
    createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: ["typescript"] }),
  );
  const twoslash = createTransformerFactory(
    createTwoslasher({ vfsRoot: repoRoot, compilerOptions }),
    rendererRich() as never,
  )({});

  // Collect every documented symbol, grouped by its source file, so each file is twoslashed once.
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
      const summary = yield* readJson(
        nodePath.join(dataDir, pkg.slug, `${module.slug}.json`),
        ModuleSummaryS,
      );
      for (const row of summary?.symbols ?? []) {
        const detail = yield* readJson(
          nodePath.join(dataDir, pkg.slug, module.slug, `${symbolFileKey(row.name)}.json`),
          SymbolS,
        );
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
    const hash = createHash("sha1").update(fileText).digest("hex");
    nextCache[relFile] = hash;
    if (cache[relFile] === hash) {
      skipped += syms.length;
      continue;
    }
    const input = ["// @noErrors", `// @filename: ${relFile}`, fileText].join("\n");
    const hast: Hast = yield* Effect.sync(() =>
      highlighter.codeToHast(input, {
        lang: "typescript",
        themes: THEMES,
        transformers: [twoslash],
      }),
    ).pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (hast === undefined) {
      missed += syms.length;
      continue;
    }
    const pre = (hast.children ?? []).find((c: Hast) => c.tagName === "pre");
    const code = (pre?.children ?? []).find((c: Hast) => c.tagName === "code");
    const lineEls: Array<Hast> = (code?.children ?? []).filter(
      (c: Hast) => c.type === "element" && String(c.properties?.class ?? "").includes("line"),
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
      const inner = slice.map((l, i) => toHtml(l) + (i < slice.length - 1 ? "\n" : "")).join("");
      const html = `<pre class="${escAttr(preClass)}"><code>${inner}</code></pre>`;
      yield* writeText(
        nodePath.join(hoversDir, sym.pkg, sym.moduleSlug, `${symbolFileKey(sym.name)}.src.html`),
        html,
      );
      written += 1;
    }
  }
  yield* writeText(cachePath, `${JSON.stringify(nextCache)}\n`);
  yield* Console.log(
    `hovers: ${pkgs.length} pkgs, ${files} files, ${written} written, ${skipped} cached, ${missed} unmatched`,
  );
});

const main = program.pipe(
  Effect.tapCause((cause) => Console.error(String(cause))),
  Effect.provide(NodeServices.layer),
);
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
