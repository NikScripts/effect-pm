// Generate — or --check — docs/standards/manifest.json from the corpus blocks.
//
// This app's `effect` install ships no Node-backed FileSystem layer, so per Effect
// Style ("if no service exists for a primitive, isolate the Node API behind a small
// Effect-returning helper rather than scattering raw calls") the three fs touches are
// wrapped in typed helpers below; everything else is an ordinary Effect program, and
// failures (a bad block, a stale manifest) are values in the error channel.
//
//   pnpm docs:manifest           regenerate manifest.json
//   pnpm docs:manifest --check   fail (exit 1) if manifest.json is stale

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, Exit } from "effect";
import { stripDocBanner } from "../src/lib/doc-banner.js";
import { buildManifest, parseChapter } from "../src/lib/standards-manifest.js";

const standardsDir = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "../../standards",
);
const manifestPath = nodePath.join(standardsDir, "manifest.json");

// One named error per failure mode (Principles → Errors are values).
class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}
class ManifestStale extends Data.TaggedError("ManifestStale")<{
  readonly summary: string;
}> {}

// --- isolated Node IO — the only raw node:* in the program, behind typed effects ---
const listMarkdown = Effect.try({
  try: () => nodeFs.readdirSync(standardsDir).filter((f) => f.endsWith(".md")).sort(),
  catch: (cause) => new FileError({ path: standardsDir, cause }),
});
const readText = (path: string) =>
  Effect.try({
    try: () => nodeFs.readFileSync(path, "utf8"),
    catch: (cause) => new FileError({ path, cause }),
  });
const writeText = (path: string, text: string) =>
  Effect.try({
    try: () => nodeFs.writeFileSync(path, text),
    catch: (cause) => new FileError({ path, cause }),
  });
const readTextOr = (path: string, fallback: string) =>
  Effect.try({
    try: () => (nodeFs.existsSync(path) ? nodeFs.readFileSync(path, "utf8") : fallback),
    catch: (cause) => new FileError({ path, cause }),
  });

// Parse every chapter through the SHARED pipeline, then assemble the manifest.
const buildFromCorpus = listMarkdown.pipe(
  Effect.flatMap((files) =>
    Effect.forEach(files, (file) =>
      readText(nodePath.join(standardsDir, file)).pipe(
        // GitHub-facing banners attach attrs to a `para` and break page-block detection —
        // same strip the Vite content loader applies before parse.
        Effect.map(stripDocBanner),
        Effect.flatMap(parseChapter),
        Effect.map(({ meta }) => meta),
      ),
    ),
  ),
  Effect.map(buildManifest),
);

// Write, or compare-and-fail on drift. The rendered JSON is the single artifact both
// modes derive from, so `--check` and a real write can never disagree.
const run = (check: boolean) =>
  buildFromCorpus.pipe(
    Effect.flatMap((manifest) => {
      const json = `${JSON.stringify(manifest, null, 2)}\n`;
      const summary = `${manifest.ruleCount} rules across ${manifest.chapters.length} chapters`;
      if (!check) {
        return writeText(manifestPath, json).pipe(
          Effect.flatMap(() => Console.log(`wrote manifest.json — ${summary}`)),
        );
      }
      return readTextOr(manifestPath, "").pipe(
        Effect.flatMap((current) =>
          current === json
            ? Console.log(`manifest up to date — ${summary}`)
            : Effect.fail(new ManifestStale({ summary })),
        ),
      );
    }),
    Effect.tapError((error) =>
      Console.error(
        error._tag === "ManifestStale"
          ? `manifest.json is stale — run \`pnpm docs:manifest\`. (${error.summary})`
          : `manifest generation failed (${error._tag})`,
      ),
    ),
  );

// The single runtime edge: run the description, map a failure to a non-zero exit.
Effect.runPromiseExit(run(process.argv.includes("--check"))).then((exit) => {
  if (Exit.isFailure(exit)) process.exitCode = 1;
});
