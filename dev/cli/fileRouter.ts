/**
 * `hyp file-router` — emit / check typed `paths.gen.ts` for the file router.
 */
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as Path from "effect/Path";
import {
  checkPaths,
  emitPaths,
  nodeLayer,
} from "../../src/internal/fileRouterPaths";

const pagesFlag = Flag.string("pages").pipe(
  Flag.withDescription("Pages directory to walk."),
  Flag.withDefault("src/pages"),
);

const outFlag = Flag.string("out").pipe(
  Flag.withDescription("Generated paths module."),
  Flag.withDefault("src/paths.gen.ts"),
);

const emit = Command.make("emit", {
  pages: pagesFlag,
  out: outFlag,
}).pipe(
  Command.withDescription("Write paths.gen.ts from the pages tree."),
  Command.withHandler(({ pages, out }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const pagesDir = path.resolve(pages);
      const outFile = path.resolve(out);
      const result = yield* emitPaths({ pagesDir, outFile });
      yield* Effect.logInfo(
        result.changed
          ? `file-router: wrote ${outFile} (${result.entries.length} paths)`
          : `file-router: up to date ${outFile} (${result.entries.length} paths)`,
      );
    }).pipe(Effect.provide(nodeLayer)),
  ),
);

const check = Command.make("check", {
  pages: pagesFlag,
  out: outFlag,
}).pipe(
  Command.withDescription("Fail if paths.gen.ts is missing or stale."),
  Command.withHandler(({ pages, out }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const outFile = path.resolve(out);
      yield* checkPaths({
        pagesDir: path.resolve(pages),
        outFile,
      });
      yield* Effect.logInfo(`file-router: check OK ${outFile}`);
    }).pipe(Effect.provide(nodeLayer)),
  ),
);

export const fileRouterCommand = Command.make("file-router").pipe(
  Command.withDescription(
    "Typed file-router path table (emit / check paths.gen.ts).",
  ),
  Command.withSubcommands([emit, check]),
);
