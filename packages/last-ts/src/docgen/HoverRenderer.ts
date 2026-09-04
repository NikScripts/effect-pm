/**
 * The linked hover content of an exported symbol — its type as the checker sees it, printed to
 * {@link TypePrinter.Part} runs plus the same ranges as {@link Annotate.Link}s, ready to highlight
 * with shiki and link via {@link Annotate.transformer}. A TYPE ALIAS prints its declaration's
 * right-hand side (the parsed node — every reference resolves); an interface or class prints its
 * declared type, which the compiler renders as the bare self-reference (`Holder<A>`), its name
 * linked to its own page via the printer's type-guided hint (the builder attaches no symbol to the
 * synthesized self-name). A value export prints its type at the declaration.
 *
 * When the display text is reformatted before rendering (prettier line-breaking a long type), remap
 * the links with {@link Annotate.realign}.
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import ts from "typescript";
import * as Annotate from "./Annotate.js";
import * as TsProgram from "./TsProgram.js";
import * as TypePrinter from "./TypePrinter.js";

const TypeId = "~docgen/HoverRenderer";

/**
 * A hover's content: the linked parts, their concatenation (the display text), and the linked
 * ranges of that text.
 *
 * @category models
 * @since 1.0.0
 */
export interface Hover {
  readonly parts: ReadonlyArray<TypePrinter.Part>;
  readonly text: string;
  readonly links: ReadonlyArray<Annotate.Link>;
}

/**
 * Renders an exported symbol's hover.
 *
 * @category models
 * @since 1.0.0
 */
export interface HoverRenderer {
  readonly [TypeId]: typeof TypeId;
  /** The linked hover of an export (aliases resolved). None for a symbol with no declaration. */
  readonly hover: (symbol: ts.Symbol) => Option.Option<Hover>;
}

/**
 * The `HoverRenderer` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const HoverRenderer: Context.Service<HoverRenderer, HoverRenderer> =
  Context.Service("docgen/HoverRenderer");

// A re-export arrives as an Alias symbol carrying no docs or type of its own (same rule as the
// Extractor and LinkResolver).
const resolveAlias = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
  (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

const typeish = ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class;

/**
 * A {@link HoverRenderer} over the current {@link TsProgram} and {@link TypePrinter}.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer: Layer.Layer<
  HoverRenderer,
  never,
  TsProgram.TsProgram | TypePrinter.TypePrinter
> = Layer.effect(HoverRenderer)(
  Effect.gen(function* () {
    const program = yield* TsProgram.TsProgram;
    const printer = yield* TypePrinter.TypePrinter;
    return {
      [TypeId]: TypeId,
      hover: (exportSymbol) => {
        const checker = program.checker;
        const symbol = resolveAlias(checker, exportSymbol);
        return Option.map(Option.fromNullishOr(symbol.getDeclarations()?.[0]), (decl) => {
          const parts = ts.isTypeAliasDeclaration(decl)
            ? printer.printNode(decl.type)
            : printer.printType(
                (symbol.flags & typeish) !== 0
                  ? checker.getDeclaredTypeOfSymbol(symbol)
                  : checker.getTypeOfSymbolAtLocation(symbol, decl),
                decl
              );
          return {
            parts,
            text: parts.map((part) => part.text).join(""),
            links: Annotate.fromParts(parts),
          };
        });
      },
    };
  })
);
