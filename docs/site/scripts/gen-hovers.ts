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

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as os from "node:os";
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

// Shard protocol: the orchestrator (no --shard flag) spawns N children of this script, each with
// `--shard=i/n`. A shard processes every n-th file, writes its cache fragment
// (cache.shard-i.json) and a progress row (progress.shard-i.json) the orchestrator aggregates
// into public/hover-progress.json — which the dev navbar polls to show a restamp pill.
const shardArg = process.argv.find((a) => a.startsWith("--shard="));
const shard = (() => {
  const m = shardArg === undefined ? null : /^--shard=(\d+)\/(\d+)$/.exec(shardArg);
  return m === null ? undefined : { i: Number(m[1]), n: Number(m[2]) };
})();
// Two lanes by SOURCE SIZE: a few monster files (Schema.ts, the generated httpapi internals)
// need the ~7GB heap the old single process had; everything else fits a small heap. One heavy
// worker + N light workers keeps peak RAM inside the machine. The split is derived from file
// sizes identically in every process — no coordination channel needed.
const lane = process.argv.find((a) => a.startsWith("--lane="))?.slice("--lane=".length);
const heavyBytes = Number(process.env.HOVER_HEAVY_BYTES ?? 200_000);
const shardLabel = shard === undefined ? "all-0" : `${lane ?? "all"}-${shard.i}`;
const pkgArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const progressPath = nodePath.join(repoRoot, "docs/site/public/hover-progress.json");

interface ShardProgress {
  readonly done: number;
  readonly total: number;
  readonly written: number;
  readonly skipped: number;
  readonly missed: number;
  readonly files: number;
  readonly exited: boolean;
}

const orchestrate = Effect.gen(function* () {
  // Worker plan is RAM-bounded, not core-bounded: uniform shards can't work because the
  // monster files need a ~7GB heap while N × 7GB doesn't fit a 24GB machine (8 × the inherited
  // 8GB NODE_OPTIONS drowned it in swap; 5 × 3.5GB OOM-killed the shard that drew Schema.ts).
  // So: ONE heavy-lane worker with the big heap for files over HOVER_HEAVY_BYTES, N light-lane
  // workers with small heaps for the rest.
  const lightShards = Math.max(1, Math.min(4, os.cpus().length - 2, Number(process.env.HOVER_SHARDS ?? 4)));
  const lightHeapMb = Number(process.env.HOVER_SHARD_HEAP ?? 2560);
  const heavyHeapMb = Number(process.env.HOVER_HEAVY_HEAP ?? 8192);
  const plan: ReadonlyArray<{ label: string; args: ReadonlyArray<string>; heap: number }> = [
    { label: "heavy-0", args: ["--lane=heavy", "--shard=0/1"], heap: heavyHeapMb },
    ...Array.from({ length: lightShards }, (_, i) => ({
      label: `light-${i}`,
      args: ["--lane=light", `--shard=${i}/${lightShards}`],
      heap: lightHeapMb,
    })),
  ];
  const startedAt = Date.now();
  const children = plan.map((p) =>
    spawn(process.execPath, [...process.execArgv, process.argv[1], ...pkgArgs, ...p.args], {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, NODE_OPTIONS: `--max-old-space-size=${p.heap}` },
    })
  );
  const readShard = (label: string): Effect.Effect<ShardProgress | undefined, never, FileSystem.FileSystem> =>
    readJson(
      nodePath.join(hoversDir, `progress.shard-${label}.json`),
      Schema.Struct({
        done: Schema.Number,
        total: Schema.Number,
        written: Schema.Number,
        skipped: Schema.Number,
        missed: Schema.Number,
        files: Schema.Number,
        exited: Schema.Boolean,
      })
    );
  const aggregate = (status: "running" | "done") =>
    Effect.gen(function* () {
      const rows: Array<ShardProgress> = [];
      for (const p of plan) {
        const row = yield* readShard(p.label);
        if (row !== undefined) rows.push(row);
      }
      const sum = (f: (r: ShardProgress) => number): number => rows.reduce((a, r) => a + f(r), 0);
      yield* writeText(
        progressPath,
        `${JSON.stringify({
          status,
          done: sum((r) => r.done),
          total: sum((r) => r.total),
          written: sum((r) => r.written),
          skipped: sum((r) => r.skipped),
          missed: sum((r) => r.missed),
          startedAt,
          updatedAt: Date.now(),
        })}\n`
      );
      return rows;
    });
  const allExited = Promise.all(
    children.map(
      (c) =>
        new Promise<number>((resolve) => {
          c.on("exit", (code) => resolve(code ?? 1));
        })
    )
  );
  let finished = false;
  void allExited.then(() => {
    finished = true;
  });
  while (!finished) {
    yield* aggregate("running");
    yield* Effect.promise(
      () => new Promise<void>((resolve) => setTimeout(resolve, 2000))
    ).pipe(Effect.race(Effect.promise(() => allExited.then(() => undefined))));
  }
  const codes = yield* Effect.promise(() => allExited);
  // Final aggregate BEFORE cleanup — the fragments are the only record of the totals.
  const rows = yield* aggregate("done");
  // Merge shard cache fragments — together they cover every enumerated file, replacing cache.json
  // wholesale exactly like the single-process run did.
  const fs = yield* FileSystem.FileSystem;
  const merged: Record<string, string> = {};
  for (const p of plan) {
    const fragment =
      (yield* readJson(
        nodePath.join(hoversDir, `cache.shard-${p.label}.json`),
        Schema.Record(Schema.String, Schema.String)
      )) ?? {};
    Object.assign(merged, fragment);
    yield* fs
      .remove(nodePath.join(hoversDir, `cache.shard-${p.label}.json`))
      .pipe(Effect.orElseSucceed(() => undefined));
    yield* fs
      .remove(nodePath.join(hoversDir, `progress.shard-${p.label}.json`))
      .pipe(Effect.orElseSucceed(() => undefined));
  }
  yield* writeText(cachePath, `${JSON.stringify(merged)}\n`);
  const sum = (f: (r: ShardProgress) => number): number => rows.reduce((a, r) => a + f(r), 0);
  yield* Console.log(
    `hovers: ${plan.length} shards (1 heavy + ${lightShards} light), ${sum((r) => r.files)} files, ${sum((r) => r.written)} written, ${sum(
      (r) => r.skipped
    )} cached, ${sum((r) => r.missed)} unmatched${codes.some((c) => c !== 0) ? " (SHARD FAILURES)" : ""}`
  );
  if (codes.some((c) => c !== 0)) return yield* Effect.fail(new Error("shard failed"));
});

const program = Effect.gen(function* () {
  const wanted = pkgArgs;
  // Only the effect-smol packages: their source lives under repos/ and needs the precompute.
  const pkgs = (yield* packages())
    .filter((p) => p.slug !== "hyperlink-ts")
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
  // This shard's slice: lane first (by source size — every process derives the same split),
  // then every n-th file within the lane. Solo runs (no --shard) take everything.
  const fsService = yield* FileSystem.FileSystem;
  const sized: Array<readonly [string, Array<Sym>, number]> = [];
  for (const [relFile, syms] of byFile) {
    const info = yield* fsService
      .stat(nodePath.join(repoRoot, relFile))
      .pipe(Effect.orElseSucceed(() => undefined));
    sized.push([relFile, syms, info === undefined ? 0 : Number(info.size)]);
  }
  const inLane = sized.filter(([, , size]) =>
    lane === undefined ? true : lane === "heavy" ? size > heavyBytes : size <= heavyBytes
  );
  const mine: Array<readonly [string, Array<Sym>]> = inLane
    .filter((_, idx) => shard === undefined || idx % shard.n === shard.i)
    .map(([relFile, syms]) => [relFile, syms] as const);
  const shardProgressPath =
    shard === undefined ? undefined : nodePath.join(hoversDir, `progress.shard-${shardLabel}.json`);
  let done = 0;
  const reportProgress = (exited: boolean): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
    shardProgressPath === undefined
      ? Effect.void
      : writeText(
          shardProgressPath,
          `${JSON.stringify({ done, total: mine.length, written, skipped, missed, files, exited })}\n`
        );
  for (const [relFile, syms] of mine) {
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
      // properties.class is an ARRAY of tokens — String() would comma-join it into one bogus
      // class ("shiki,shiki-themes,…"), which silently broke every `.shiki` selector on
      // sidecar-rendered code (dark-mode colors most visibly).
      const preClassRaw = pre?.properties?.class ?? "shiki";
      const preClass = Array.isArray(preClassRaw) ? preClassRaw.join(" ") : String(preClassRaw);
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
    done += 1;
    yield* reportProgress(false);
  }
  if (shard === undefined) {
    yield* writeText(cachePath, `${JSON.stringify(nextCache)}\n`);
    yield* Console.log(
      `hovers: ${pkgs.length} pkgs, ${files} files, ${written} written, ${skipped} cached, ${missed} unmatched`
    );
  } else {
    yield* writeText(
      nodePath.join(hoversDir, `cache.shard-${shardLabel}.json`),
      `${JSON.stringify(nextCache)}\n`
    );
    yield* reportProgress(true);
  }
});

// Orchestrate when we're the top process (no --shard) and parallelism is available; the spawned
// children re-enter this script as shard workers. `tsx` re-runs via process.execArgv, so children
// inherit the loader and NODE_OPTIONS.
const entry: Effect.Effect<void | undefined, FileError | Error, FileSystem.FileSystem> =
  shard === undefined && process.env.HOVER_SHARDS !== "1" ? orchestrate : program;
const main = entry.pipe(
  Effect.tapCause((cause) => Console.error(String(cause))),
  Effect.provide(NodeServices.layer)
);
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
