/**
 * Runtime smoke for the file-router prototype.
 *
 * Run: `pnpm exec tsx examples/ui/file-router/run.ts`
 * Regen: `node examples/ui/file-router/scripts/gen-paths.mjs`
 */
import { Effect } from "effect";
import { filePaths, protoUrls, destinationsOf } from "./api.js";

const program = Effect.gen(function* () {
  yield* Effect.logInfo(`typed FilePath union (${filePaths.length}):`);
  for (const p of filePaths) {
    yield* Effect.logInfo(`  ${p}`);
  }
  yield* Effect.logInfo("urlBuilder:");
  yield* Effect.logInfo(`  index            ${protoUrls.index()}`);
  yield* Effect.logInfo(`  docs_chapter     ${protoUrls.docs_chapter("routing")}`);
  yield* Effect.logInfo(`  api_pkg          ${protoUrls.api_pkg("effect")}`);
  yield* Effect.logInfo(`  search           ${protoUrls.search()}`);
  yield* Effect.logInfo(`destinations: ${destinationsOf().length}`);
});

void Effect.runPromise(program);
