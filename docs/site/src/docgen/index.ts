/**
 * A composable, compiler-accurate docgen — extract an API model from TypeScript source and resolve
 * every type reference to its doc page the way an IDE does (`getSymbolAtLocation`, not name-matching).
 *
 * Each capability is an Effect service behind a layer; wire the ones you need. Currently: the API
 * {@link Model} (Schema SSOT), the compiler substrate ({@link TsProgram}), the location→url index
 * ({@link SymbolIndex}), and compiler resolution ({@link LinkResolver}). Extraction and rendering land
 * in later phases.
 *
 * @since 1.0.0
 */
export * as Extractor from "./Extractor.js";
export * as LinkResolver from "./LinkResolver.js";
export * as Model from "./Model.js";
export * as Slug from "./Slug.js";
export * as SymbolIndex from "./SymbolIndex.js";
export * as TsProgram from "./TsProgram.js";
export * as TypePrinter from "./TypePrinter.js";
