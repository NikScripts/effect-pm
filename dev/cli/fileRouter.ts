/**
 * `hyp file-router` — emit / check typed `paths.gen.ts` for the file router.
 */
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as NodePath from "node:path";
import {
  checkPaths,
  emitPaths,
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
      const pagesDir = NodePath.resolve(pages);
      const outFile = NodePath.resolve(out);
      const result = emitPaths({ pagesDir, outFile });
      yield* Effect.logInfo(
        result.changed
          ? `file-router: wrote ${outFile} (${result.entries.length} paths)`
          : `file-router: up to date ${outFile} (${result.entries.length} paths)`,
      );
    }),
  ),
);

const check = Command.make("check", {
  pages: pagesFlag,
  out: outFlag,
}).pipe(
  Command.withDescription("Fail if paths.gen.ts is missing or stale."),
  Command.withHandler(({ pages, out }) =>
    Effect.gen(function* () {
      checkPaths({
        pagesDir: NodePath.resolve(pages),
        outFile: NodePath.resolve(out),
      });
      yield* Effect.logInfo(`file-router: check OK ${NodePath.resolve(out)}`);
    }),
  ),
);

export const fileRouterCommand = Command.make("file-router").pipe(
  Command.withDescription(
    "Typed file-router path table (emit / check paths.gen.ts).",
  ),
  Command.withSubcommands([emit, check]),
);
