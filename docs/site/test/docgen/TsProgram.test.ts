import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as TsProgram from "../../src/docgen/TsProgram.js";

const fixture = fileURLToPath(new URL("./fixtures/sample.ts", import.meta.url));

const layer = TsProgram.layer({
  entries: [fixture],
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    noEmit: true,
  },
});

describe("TsProgram", () => {
  it.effect("parses the entry and exposes it", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      expect(program.sourceFiles.length).toBeGreaterThan(0);
      expect(Option.isSome(program.sourceFile(fixture))).toBe(true);
      expect(Option.isNone(program.sourceFile("/does/not/exist.ts"))).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("the checker resolves the module's exports", () =>
    Effect.gen(function* () {
      const program = yield* TsProgram.TsProgram;
      const sf = Option.getOrThrow(program.sourceFile(fixture));
      const moduleSym = Option.getOrThrow(
        Option.fromNullishOr(program.checker.getSymbolAtLocation(sf)),
      );
      const exports = program.checker.getExportsOfModule(moduleSym).map((e) => e.getName());
      expect(exports).toContain("Widget");
      expect(exports).toContain("makeWidget");
    }).pipe(Effect.provide(layer)),
  );
});
