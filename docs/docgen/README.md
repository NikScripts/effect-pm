# @nikscripts/docgen

Effect-native TypeScript docgen. Everything resolves through the **compiler** — a missing link
always beats a wrong one (zero-guess rule: no name-heuristic matching anywhere).

Consumed as source (`file:` dependency, subpath exports per module — `@nikscripts/docgen/Extractor`).
Typechecked and tested through the consuming site (`docs/site`): `tsc`, `vitest run test/docgen`,
and the byte-diff gate over `api-data`.

pnpm materializes a `file:` dependency as a hard-linked COPY with peers resolved from the consumer
(that is what guarantees a single `effect` instance across site + docgen). The cost: after editing
sources here, run `pnpm install` in `docs/site` (~1s) to re-sync the copy before running anything.

## Modules

- `TsProgram` — shared `ts.Program` service (+ `fromProgram` for an existing program)
- `SymbolIndex` — declaration location → site URL; ambiguity resolves to *none*
- `LinkResolver` — node/symbol → URL with the declaration-site guard
- `Extractor` — exported-surface walk producing the doc model (`Model`)
- `TypePrinter` — compiler-accurate type text with symbol capture (home-retry + type-guided hints)
- `Annotate` — link ranges over printed text; two-phase shiki transformer; hast application
- `SourceRenderer` / `HoverRenderer` — signature blocks and hover payloads
- `Slug` — shared slugging
