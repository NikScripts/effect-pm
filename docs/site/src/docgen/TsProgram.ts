/**
 * A TypeScript program + type checker over a set of entry files — the compiler substrate every other
 * docgen service reads through. One program is shared: resolution, extraction, and type printing all
 * ask the same checker, so a reference resolves to exactly the declaration the model recorded.
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import ts from "typescript";

const TypeId = "~docgen/TsProgram";

/**
 * The compiler substrate: a checker plus access to the parsed source files.
 *
 * @category models
 * @since 1.0.0
 */
export interface TsProgram {
  readonly [TypeId]: typeof TypeId;
  /** The program's type checker — the single source of truth for symbol/type resolution. */
  readonly checker: ts.TypeChecker;
  /** The parsed source file at an absolute path, if the program includes it. */
  readonly sourceFile: (fileName: string) => Option.Option<ts.SourceFile>;
  /** Every source file the program parsed (entry roots and everything they import). */
  readonly sourceFiles: ReadonlyArray<ts.SourceFile>;
}

/**
 * The `TsProgram` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const TsProgram: Context.Service<TsProgram, TsProgram> = Context.Service("docgen/TsProgram");

/**
 * Options for {@link layer}: the entry files to root the program at, and the compiler options.
 *
 * The compiler options SHOULD map `effect` / `@effect/*` imports to the documented SOURCE (e.g.
 * `repos/effect/packages/effect/src`), so a cross-package reference resolves to a declaration the model
 * knows — otherwise it resolves into `node_modules` and links nowhere.
 *
 * @category models
 * @since 1.0.0
 */
export interface Options {
  readonly entries: ReadonlyArray<string>;
  readonly compilerOptions: ts.CompilerOptions;
}

/**
 * A {@link TsProgram} built from entry files + compiler options. Building the program is synchronous
 * but heavy — provide the layer once and share it across the run.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer = (options: Options): Layer.Layer<TsProgram> =>
  Layer.sync(TsProgram)(() => {
    const program = ts.createProgram([...options.entries], options.compilerOptions);
    const checker = program.getTypeChecker();
    return {
      [TypeId]: TypeId,
      checker,
      sourceFile: (fileName) => Option.fromNullishOr(program.getSourceFile(fileName)),
      sourceFiles: program.getSourceFiles(),
    };
  });
