# Docgen system — design doc (LIVING; we work from this)

Status: **Phases 1–5 ✅ + capture pass ✅ — generator cut over, compiler links live in EVERY surface
(source panels, popups incl. full-capture substitution + expand box, guide hovers, signature blocks,
{@link} chips), name-heuristic DELETED (zero-guess ruling). Remaining: Phase 6 (optional extraction)
+ ONE capture-rate follow-up (enclosing-scope symbol attachment — see step 4 notes). See HANDOFF.**
Owner: Nik. Author: pairing session. Branch: **`docs/standards-corpus`** — the docgen replaces the
linking internals of the API reference, which is unmerged on this branch, so it CANNOT branch from
`integration` (would lack the prerequisite gen-api/api-data). Related work stays on one branch.

## Why

The API reference's linking is currently a **name-heuristic** (`api-links.ts` unambiguous-bucket +
`api-linkify.ts`). It can't link colliding names (`Array`, `Error`, `Duration`) or a module's own type,
and it guesses. A spike (`scripts/api-resolve.ts`, proven) showed **compiler resolution** — the IDE's
"go to definition" via `checker.getSymbolAtLocation` → declaration → doc URL — resolves those exactly,
with zero guessing. We want to replace the heuristic wholesale with compiler resolution.

That pulls the whole pipeline (`gen-api` model extraction, `gen-hovers` rendering, `api-data` reading)
into scope. Rather than bolt onto three ad-hoc scripts, we rebuild them as a **composable, Effect-native
docgen** — services + layers, Schema model, typed errors — that could stand alone as its own package.

## Goals & non-goals

Goals:
- **Compiler-accurate linking** everywhere (source tokens + hover type text), no name-matching.
- **Composable**: capabilities are Effect services wired by layers; a consumer supplies their own
  compiler options, output sink, and (eventually) renderer.
- **Effect to the fullest**: services (`Context.Service`), layers, typed errors (`Data.TaggedError`),
  Schema for the model, platform services (`FileSystem`/`Path`/`Command`), Streams where fan-out helps.
- **Standards**: no `as` casts; exported `interface`s not schema-`type` aliases; Schema = SSOT; LSP
  clean; one field per line; camelCase values; tests at every layer; incremental + verifiable.
- **Package-shaped**: structured so extraction to `@nikscripts/docgen` (or similar) is a move, not a
  rewrite — public surface = the services + layers + schemas.

Non-goals (for now): a general TypeDoc replacement; theming; non-TS languages; changing the site's
routing/hybrid-render decisions (those stay).

## Architecture (proposed — OPEN for your input)

A small set of services, each behind a `Layer`. Dependencies point downward.

```
                 Emitter ── writes model JSON + sidecars (FileSystem, Path)
                    │
   SourceRenderer ──┤ (declaration source + linked tokens + hovers)
        │           │
   HoverRenderer ───┤ (compact type + expanded type + markdown JSDoc, all linked)
        │           │
    TypePrinter ────┤ (ts.Type -> linked display parts — THE hard part)
        │           │
   LinkResolver ────┤ (node -> Option<Url>; the proven compiler resolution)
      │     │       │
 TsProgram  SymbolIndex   (ts.Program+checker per pkg | global location->url index)
```

- **`TsProgram`** — wraps one package's `ts.Program` + `TypeChecker`. `Layer` builds it from compiler
  options + entry files (scoped — the program is a resource). Exposes checker + source files + resolve
  primitives. OPEN: the checker is mutable/stateful — we wrap access, never expose it for mutation.
- **`SymbolIndex`** — the global `"<repo-rel file>#<line>" -> url` map (+ maybe `ts.Symbol -> url`),
  built from the extracted model. Enables cross-package resolution (a token in `platform-node`
  pointing at `effect`). `Layer.effect` from the model.
- **`LinkResolver`** — `resolve(node): Option<Url>`. Depends on `TsProgram` + `SymbolIndex`. Skips type
  params + built-ins by nature. This is `scripts/api-resolve.ts`, promoted to a service.
- **`Extractor`** — walks a `TsProgram`, emits the Schema `Model` (packages → entries → symbols). Ports
  `gen-api`'s extraction; keeps the DocScope/ExportBucket distinctions `@effect/jsdocs` uses.
- **`TypePrinter`** — renders a `ts.Type`/`TypeNode` to `ReadonlyArray<DisplayPart>` where each part is
  `{ text, url? }`, resolving named references via `LinkResolver`. THE risk — the full type grammar.
- **`HoverRenderer`** / **`SourceRenderer`** — assemble popover + source-panel HTML from the printer +
  resolver + markdown. OPEN: reuse shiki/twoslash and map links on, or render ourselves (see D1).
- **`Emitter`** — pluggable output sink (FS sidecars now; could be memory/other). `FileSystem`+`Path`.

Pipeline: `run = Effect.gen(…)` provides the layers, extracts each package, folds the `SymbolIndex`,
renders per symbol (candidate for `Stream` with bounded concurrency), emits. Typed error channel:
`ExtractError | ResolveError | RenderError | EmitError` (all `Data.TaggedError`).

Schema/model: the model schemas are the SSOT (as today in `api-data`), moved into the docgen and
EXPORTED; site interfaces derive from them. Reuses the existing `ApiSymbol`/`ApiEntry` shapes.

## The hard parts → prototype BEFORE investing (Phase 1)

1. **P1 — TypePrinter over the real grammar.** Can we render `ts.Type` to linked parts for generics,
   unions/intersections, conditionals, mapped types, `infer`, template-literal types? Prototype on ~10
   representative effect types; measure coverage + where it degrades. THIS decides feasibility of
   replacing the hover heuristic. Fallback if it caps out: `typeToTypeNode` + walk `TypeReference` nodes
   (structural, not string).
2. **P2 — TsProgram / LinkResolver as Effect services.** Wrap the (stateful, mutable) compiler in a
   clean service + scoped layer; resolve a node end-to-end through the service graph. Prove Effect
   composes over the compiler without fighting it.
3. **P3 — Render application.** Map resolved links onto the rendered source panel. Decides D1: shiki
   spans don't carry offsets, so either re-tokenize with positions, or drive rendering from the checker
   ourselves. Prototype both enough to choose.
4. **P4 — Cross-package resolution** via `SymbolIndex` (spike proved within-file; prove pkg→pkg).

Each prototype is throwaway, lives under `scratchpad/` or a `_proto` file, and answers ONE question.

## Open decisions (need your call before Phase 2)

- **D1 — renderer**: keep shiki+twoslash and *map* compiler links onto their output, OR build our own
  checker-driven renderer (full control, huge rebuild, but the "true" composable answer)? Biggest fork.
- **D2 — boundary**: build in-repo as `docs/site/src/docgen/**` (or `packages/docgen` in-repo) first,
  extract to a standalone published package only if we want it? (Recommend: in-repo module first,
  package-shaped, extract later.)
- **D3 — TypePrinter depth**: full grammar vs. a pragmatic subset with a graceful "plain text" fallback
  for exotic types? (Recommend: subset + fallback, expand as needed — proven by P1.)
- **D4 — cutover**: big-bang replace `gen-api`+`gen-hovers`+heuristic, or run the new system alongside
  and migrate surface-by-surface? (Recommend: alongside, migrate incrementally, delete the heuristic
  last.)

## Staged plan (extremely slow, verify each step)

- **Phase 0** — this doc; lock architecture + D1–D4 with owner. (NOW)
- **Phase 1** — prototypes P1–P4; record findings back here; re-decide D1/D3 on evidence.
- **Phase 2** — core services: `TsProgram`, `SymbolIndex`, `LinkResolver` (+ tests). No render change.
- **Phase 3** — `Extractor` service (port gen-api); model unchanged, output identical (byte-diff gate).
- **Phase 4** — `TypePrinter` + `HoverRenderer` + `SourceRenderer`.
- **Phase 5** — integrate: new system feeds the site; retire the heuristic; verify parity + build.
- **Phase 6 (optional)** — extract to a package.

Gate between phases: full tsc + LSP clean, tests green, and (3+) byte-identical or better output.

## Standards checklist (applied every diff)

no `as` casts · exported `interface`s (not schema `type`) · Schema = SSOT · effect/platform not node:* for
IO · typed `Data.TaggedError` errors · services as `Context.Service`, layers for wiring · one field per
line · PascalCase only for type/class/namespace, camelCase values · `effect-language-service diagnostics`
clean · tests per layer · commit+push per step · branch from `integration`.

## Phase 1 findings

- **P1 — TypePrinter: FEASIBLE (the make-or-break, answered positively).**
  - Resolution is trivial and exact — `getSymbolAtLocation` → dealias → skip type-params → declaration
    line → `locations` map → url. Every named ref that resolved, resolved correctly (0 false positives).
  - The winning technique: **`checker.typeToTypeNode(type, enclosing, flags)`** returns a full-grammar
    synthesized `TypeNode` (overloads, function sigs, generics, unions — everything the compiler prints),
    and **every `TypeReferenceNode` on it resolves via `getSymbolAtLocation` (20/20 on `Effect.map`)**.
    So the printer is: walk the node, emit text, resolve each `TypeReferenceNode`'s `typeName` → link;
    fall back to `ts.createPrinter().printNode()` (plain text) for node kinds we don't specially handle
    (D3 subset+fallback — graceful, expand as needed).
  - Rejected paths: the symbol-tracking `EmitTextWriter` is INTERNAL (not in the public `.d.ts`) and
    `typeToString` doesn't accept it — and reaching internals needs a cast (forbidden). A full `ts.Type`
    walker works but is TypeDoc-scale and unnecessary given typeToTypeNode.
  - ⇒ `TypePrinter` = `typeToTypeNode` + a small node-walk printer with plain-text fallback + `LinkResolver`.
- **P2 — service architecture: VALIDATED.** `Context.Service<Self, Shape>()("key")` cleanly wraps the
  (stateful) compiler: `TsProgram` (checker + source files) and `SymbolIndex` (location→url) as sync
  layers, `LinkResolver` as `Layer.effect` depending on both, `Option` for results. Wired with
  `Layer.provideMerge`/`mergeAll`, resolved 459 refs through `Effect.gen` — identical to the raw spike.
  The design's service graph works as drawn; no fighting the compiler.
- **P3 — render application: shiki CARRIES the links (D1 = map-onto-shiki CONFIRMED).** shiki's
  `TokenBase` exposes `offset` and the `span` transformer receives the token, so a transformer wraps
  each token whose offset matches a resolved identifier: `Key`→Context/Key, `Scope`→Scope/Scope,
  `NoInfer`→Types/NoInfer rendered as links in the source. NO custom renderer needed. Open tuning:
  token-boundary alignment (5/10 tokens matched on first pass — match by offset RANGE, and account for
  the twoslash preamble shift, both mechanical).
- **P4 — cross-package: WORKS, with one config detail.** A `platform-node` token → `effect` page
  (`FileSystem`→effect/FileSystem/FileSystem, `Layer`→effect/Layer/Layer) resolves ONLY when the
  program's `paths` map `effect`/`@effect/*` imports to the `repos/effect` SOURCE the model was built
  from (else they resolve into node_modules — undocumented). ⇒ `TsProgram` layer must set those paths
  (or build one program spanning all documented packages). The global `SymbolIndex` handles the rest.

**Phase 1 verdict: every risk retired.** The whole approach is proven — resolution is exact and cheap,
the TypePrinter is small (typeToTypeNode), Effect composes over the compiler, shiki carries the links,
cross-package works. Ready for Phase 2 (build the real `TsProgram`/`SymbolIndex`/`LinkResolver` services
with tests). D1 locked as map-onto-shiki.

## HANDOFF — current state + how to continue (read this first)

You are continuing the docgen build on branch `docs/standards-corpus`. Everything below is committed and
green. Work in `docs/site` (its own package: `cd docs/site` for all commands).

### What exists (all gated green, tested)
`docs/site/src/docgen/`
- `TsProgram.ts` — service: one `ts.Program` + checker over entry files (`checker`, `sourceFile`, `sourceFiles`).
- `SymbolIndex.ts` — service: `location (repo-rel file + line) → url`, built from `Entry` values.
  A location claimed by two DIFFERENT urls is ambiguous → `urlAt` returns none (no link beats a wrong link).
- `LinkResolver.ts` — service: `resolve(node) → Option<Url>` over `TsProgram` + `SymbolIndex` (the proven
  compiler resolution; dealias, skip type-params, declNode line, relativize to `repoRoot`). Only
  module-scope declarations resolve — a parameter/local/member shares its statement's LINE (e.g.
  `export const rollup = (byNode: …)`) and must NOT get the enclosing export's page.
- `Model.ts` — Schema SSOT (schemas `tag`/`source`/`symbol`/`entry` camelCase per house naming; derived
  `Tag`/`Source`/`Symbol`/`Entry` interfaces). Field order matches gen-api output → byte-identical.
- `Extractor.ts` — service, COMPLETE: `symbol(namespace, exportSym) → Option<Model.Symbol>` (gen-api's
  `toApi`) AND `package(entryPoints) → Effect<ReadonlyArray<Model.Entry>>` — the module walk (subpath +
  barrel `export * as` groups, `preferRename`, namespaced dedup, sorting) plus the `{@link}` second pass
  (builds a per-package `SymbolIndex`, provides `LinkResolver` internally, fills `docLinks`).
  KEY semantics: index locations are deduped PER RESOLVED SYMBOL in extraction order, last wins — a
  symbol re-exported under two namespaces (`Predicate.isTupleOf` / `Tuple.isTupleOf`) has two pages but
  one declaration line; gen-api's symbol-keyed map resolves to the last-extracted page.
- `Slug.ts` — canonical `slugForEntry`/`symbolFileKey`; `src/lib/api-slugs.ts` re-exports it.
- `TypePrinter.ts` — service, Phase 4: `printType(type, enclosing)` / `printNode(node)` →
  `ReadonlyArray<Part>` (`{ text, url: Option }`, adjacent unlinked runs merged). `typeToTypeNode`
  with alias-preserving NodeBuilderFlags → recursive walker (references, typeof, import-type
  unwrapped, unions/intersections, tuples incl. named/rest/optional, functions/constructors,
  conditionals/infer, type literals, template literals, predicates, operators, indexed access) →
  `ts.createPrinter` plain-text fallback for the rest (mapped types, literals, keywords). Qualified
  names resolve as a unit, falling back to the rightmost identifier.
- `Annotate.ts` — PURE render application (P3, no service): `Link` = `[start,end)` offset range + url
  into a display text; `fromParts(parts)` (printed-type links), `realign(links, source, formatted)`
  (character-alignment remap so prettier reformatting keeps links — whitespace/separator chars are
  elastic, none when texts truly differ), `transformer({links, shift?, className?})` = the shiki
  transformer: `span` hook, token `[offset, offset+len)` overlapping a link → the token element
  BECOMES an `<a class="api-typelink">` (`shift` subtracts a twoslash-preamble offset). NOTE: shiki
  bakes leading whitespace into tokens, so an anchor can start with a space (parity with the old
  popup linkifier).
- `SourceRenderer.ts` — service (TsProgram + LinkResolver): `links({file, startLine, endLine})` →
  `Option<ReadonlyArray<Annotate.Link>>` — every identifier in the 1-based inclusive span resolved
  through the LinkResolver, offsets span-relative; none for an unknown file/out-of-range span
  (loud, never a silent `[]`). A declaration's own name self-links when indexed (page links to
  itself — filter at render if unwanted).
- `HoverRenderer.ts` — service (TsProgram + TypePrinter): `hover(symbol)` → `Option<Hover>`
  (`{parts, text, links}`). Type ALIAS → prints the declaration's RHS node (parsed source, refs all
  resolve); interface/class → declared type = bare self-reference, DELIBERATELY unlinked (the node
  builder attaches no symbol to the synthesized self-name — found while testing; a hover shouldn't
  link the symbol it describes anyway); value export → type at the declaration. Reformat display
  text with `Annotate.realign` to keep links.
- `index.ts` — barrel (`export * as` each).
`docs/site/scripts/gen-api-next.ts` — the D4 bridge: gen-api's writer verbatim, extraction via the
services, writes `api-data-next/`. Any writer change must land in BOTH scripts until Phase 5 cutover.
`docs/site/test/docgen/` — `@effect/vitest` suites + `fixtures/` (incl. a fixture package for the walk).
42 tests (Annotate's exercise REAL shiki renders + REAL prettier reformatting).

### Phase 3 gate — PASSED (2026-07-16)
```
cd docs/site
npx tsx scripts/gen-api.ts && npx tsx scripts/gen-api-next.ts && diff -r api-data api-data-next
```
Byte-identical across the FULL corpus (effect-pm + effect + platform-node + sql-sqlite-node, ~24 MB).
Re-run this whenever the Extractor/LinkResolver/SymbolIndex change.

### The gate ritual — run ALL before every commit (this is non-negotiable)
```
cd docs/site
npx tsc --noEmit -p tsconfig.json 2>&1 | grep 'error TS' | grep -v 'prettier@2'      # → empty
npx effect-language-service diagnostics --file <changed file>                          # → 0 errors/warnings
npx prettier --check "src/docgen/**/*.ts" "test/docgen/**/*.ts"                         # → all clean
pnpm test                                                                              # → all pass
```
Then commit + push to `docs/standards-corpus` (never integration/main without explicit go).

### House rules (Effect package "in all ways")
- Service idiom: `const TypeId = "~docgen/X"`; `export interface X { readonly [TypeId]: typeof TypeId; … }`;
  `export const X: Context.Service<X, X> = Context.Service("docgen/X")`; layer `Layer.effect(X)(Effect.gen(…))`
  or `Layer.sync(X)(() => …)`. Mirror `effect/FileSystem`.
- `@category` + `@since 1.0.0` on every export. Exported `interface`s (never schema-`type` aliases).
- NO `as` casts, NO `!` non-null (use `Option`/guards). `Option` for absence. Schema = SSOT.
- One field per line; PascalCase only for type/class/namespace, camelCase values. printWidth 100.

### Phase 4 (renderers) — ✅ DONE (2026-07-19)
- ~~`TypePrinter`~~ ✅ — as designed: `typeToTypeNode` + walker + printer fallback, 6 tests (linked
  function type, union, plain type params, built-in generic, mapped fallback, parsed-node print).
  Re-verified the P1 spike before building: synthesized refs resolve 3/3.
- ~~`HoverRenderer` / `SourceRenderer`~~ ✅ — split as `Annotate` (pure link application: shiki
  `span` transformer w/ offset-RANGE match + `shift` for the twoslash preamble + `realign` for
  prettier reformats) + `SourceRenderer` (span identifier links) + `HoverRenderer` (symbol hover
  parts). Verified against REAL shiki 4.3.1 (`span` hook receives `token.offset` — confirmed in the
  installed types) and REAL prettier. NEW finding (locked in decisions): a declared type's
  synthesized SELF-reference carries no symbol — `getSymbolAtLocation` returns undefined for it
  (only nested refs resolve, which P1 measured); alias hovers therefore print the parsed RHS node.
- Phase 5 REMINDER (P4): the production `TsProgram` needs `paths` mapping `effect`/`@effect/*` →
  `repos/effect/…/src`, else cross-package refs hit node_modules and link nowhere.

### Phase 5 (integrate) — IN PROGRESS
- ~~Step 1 — gen-api cutover~~ ✅ (2026-07-19): `gen-api-next.ts` renamed over `gen-api.ts` (output →
  `api-data/`), prototype extractor deleted (−741 lines). Gate: full-corpus regen byte-identical.
- ~~Step 2 — compiler source links in BOTH render paths~~ ✅ (2026-07-19):
  - `gen-api.ts` now also writes `api-data/locations.json` (declaration location → url, deduped per
    line, last-wins = extraction order) — the render-time SymbolIndex feed. Model files unchanged.
  - NEW `src/lib/api-source-links.ts` — the docgen stack in the site: `loadSourceLinks()` (async
    preload, like loadHighlighter) reads locations.json + enumerates repos/effect packages into the
    P4 `paths` map; `sourceLinksFor(relFile, startLine, endLine)` = sync span links; per-package
    programs built lazily (rooted at the package barrel, `Effect.runSync` over the sync layers),
    rebuilt with accumulated roots when a file outside the barrel graph shows up.
  - `highlight.ts`: `highlightToHast`/`highlightToReact` accept `links` (Annotate ranges relative
    to the VISIBLE code); `highlightSourceWithHovers` passes the span's links (cut leaves exactly
    the span visible → span-relative offsets need NO shift, verified empirically).
  - `gen-hovers.ts`: whole-file links + a `// ---cut---` after the directives — twoslash strips
    `@noErrors` but KEEPS a bare `@filename` line in the tokenized code (tokens shift by its
    length; measured); the cut strips both, so file offsets ARE token offsets. Verified: 373/373
    anchors aligned on sql-sqlite-node; cross-package anchors (sqlite→effect/Layer,Effect,Config)
    live. DELETE `api-hovers/` before regenerating whenever the hover pipeline changes (the
    content-hash cache only tracks SOURCE changes).
  - `Annotate.transformer` is now TWO-PHASE: `span` hook only stamps a data-attr; a late `pre`
    pass wraps the token's visible children in the anchor and DESCENDS past twoslash's hover
    wrapper so popups stay OUTSIDE the link (found live: the popup was landing inside the anchor).
- ~~Step 3 — ZERO-GUESS everywhere; heuristic deleted~~ ✅ (2026-07-19). OWNER RULING: no false
  matches anywhere — a missing link always beats a guessed one. Realized as:
  - `api-links.ts` + `api-linkify.ts` DELETED (with the `links.json` writer + reader — the
    comparison scratch script now derives its own bucket). No name-bucket resolution remains.
  - POPUPS: the compact type box links via compiler resolution — `expandType` now also returns each
    hover's type printed by OUR TypePrinter (`typeText` + `typeLinks`, via
    `TsProgram.fromProgram` over the expander's language-service program + the shared
    SymbolIndex); `highlight.ts` REALIGNS those links onto the formatted display text
    (`Annotate.realign`) and the renderer applies them to the box with `Annotate.applyToHast`
    (walks rendered text in doc order, SPLITS leaf tokens at link boundaries). Realign-miss =
    unlinked popup, by design.
  - EXPANDER REWORK (the piece that made popup links real): when a block carries `// @filename:`,
    the expander strips the wrapper directive lines and hosts the code AT THE REAL PATH — relative
    imports resolve and self-declared symbols land on their true file:line (the SymbolIndex key).
    Synthetic doc blocks keep the old virtual-file behavior. `ownerLoc` also got real.
  - GOTCHA (cost a debugging round): `rendererRich` STRIPS the `"(property) "` prefix from the
    displayed popup box while the twoslash node's `.text` keeps it — displacement into box
    coordinates must count the declaration HEAD only, never the prefix.
  - PROSE: JSDoc `{@link}` + inline-code resolve ONLY through the owner symbol's compiler-resolved
    `docLinks` map (checker-resolved in the declaration's scope). Popup docs' inline-code is
    unlinked (no owner map at render time) — acceptable under the ruling.
- ~~Step 4 — CAPTURE PASS (owner: "capture everything")~~ ✅ (2026-07-19):
  - GUIDE example hovers RESTORED (deleting the heuristic had regressed them): the expander merges
    the P4 `paths` (`getPaths` → api-source-links `packageSourcePaths`) so guide blocks resolve to
    the DOCUMENTED source; twoslash keeps runtime deps for display/diagnostics; realign guards any
    version skew. 42 links on /docs/type-previews.
  - POPUP FULL-CAPTURE: for hovers with a simple declaration head (`const x: `, `Ns.member: ` —
    `simpleHead` regex; method-call heads excluded, the lazy declHead regex trips on them), the
    displayed body IS our compiler print, so realign always lands. Headless hovers keep twoslash
    text + best-effort realign.
  - EXPAND BOX linked: expandType emits `expandedLinks` (member-type parts, offsets into the
    expanded string, truncation-aware); renderer applies via `Annotate.applyToHast` on the
    `twoslash-popup-expand` box.
  - SIGNATURE BLOCKS linked: `declarationTypeLinks(relFile, line, displayed)` in api-source-links —
    call signatures realign each declaration's SOURCE slice (start → body/`=>`) onto the model's
    formatted string; other symbols realign HoverRenderer parts onto typeText. Stack now exposes
    hover/resolver/program (HoverRenderer + TypePrinter layers added).
  - {@link} CHIPS on symbol cards navigate via s.docLinks.
  - MOBILE model (owner feedback: taps were navigating instead of opening previews): on touch
    devices (`@media (hover: none)`) an in-code anchor UNDER a preview is `pointer-events: none` —
    the tap opens the preview (TwoslashHover island) — and the symbol's page link moves INTO the
    preview: the declaration NAME in the box head links to the hover's own page (`type Protocol =
    …` links `Protocol`; expandType `ownerUrl`, guarded by the LinkResolver's declaration-site
    rule so a parameter/local never claims the enclosing export's page — caught live on `byNode`).
    The EXPAND box head gets the same owner-name link (dual-preview parity). Desktop keeps both:
    hover previews + direct token links.
  - CLASS previews (service classes): class hovers are headless (`class Random`) so the expand
    embed used to skip them — the head is now SYNTHESIZED (`class Random `) and machinery members
    (`~effect/...` brands, `__@symbol@...` keys, `prototype`) are filtered in the expander. A
    SERVICE is identified STRUCTURALLY (the type carries `key` + `Service`) and its shape is
    spelled out one member per line, key first:
    `class Random { key: 'app/Random'; Service: { next: Effect.Effect<number> } }` — nested
    member links included. Other headless hovers (bare type names) stay box-less.
  - ~~capture-rate lead~~ ✅ RESOLVED (2026-07-20, `51c7958e9`) — **HOME RETRY in
    TypePrinter.printType**: per-reference resolution is tracked (`onRef`); when any reference
    fails, the type re-prints from its OWN declaration (all names in scope there) and whichever
    print PROVES more references wins — both exact, zero-guess holds; retry-winning prints show
    names as the declaring module writes them. Live: core-concepts 8 → 45 links, expand boxes
    0 → 23 library-shape anchors. Docgen test: foreign-enclosing fixture (home-lib/home-user).
    (Still true: waku dev HMR does not reliably reload these server libs — RESTART the dev server
    after editing them.)
- ~~Step 5 — refinement pass~~ ✅ (2026-07-20): link-integrity gate (`scripts/check-links.ts`,
  `docs:check-links` — every emitted href in locations/doclinks/references + ALL sidecar anchors
  must be a page in paths.json; 128,536 links, 0 dead), SELF-INVALIDATING hover cache (cache
  entries fold in a hash of the pipeline sources — the manual "delete api-hovers/" rule is
  retired), and REFERENCED-BY: gen-api's cross-reference pass resolves every declaration span
  against the global index (per-package programs + P4 paths) → `references.json` (2409 targets,
  17k edges) → capped chip section on symbol pages.
Gate: model files unchanged (links.json sidecar removed) + the site build still green. NOTE the
deploy constraints: data paths
resolve from `process.cwd()` (docs/site), NOT `import.meta.url`; symbol pages are SSR (static-all
overflows Waku's ~512 MB serializer); effect-pm is static via the literal `/api/effect-pm/…` route.
See `[[api-reference-docs]]`.

## Decisions log

- **2026-07-16 — architecture approved.** Service decomposition (TsProgram · SymbolIndex · LinkResolver ·
  Extractor · TypePrinter · HoverRenderer · SourceRenderer · Emitter) accepted as drawn.
- **D1 — renderer: MAP onto shiki+twoslash first.** Build our own checker-driven renderer only if P3
  proves shiki can't carry the compiler links. (Revisit after P3.)
- **D2 — boundary: in-repo module first**, package-shaped, extract to `@nikscripts/docgen` only if wanted.
- **D3 — TypePrinter: pragmatic subset + graceful plain-text fallback**, expand as P1 shows need.
- **D4 — cutover: alongside + incremental**, delete the name-heuristic LAST.
- **Branch: stay on `docs/standards-corpus`** (docgen depends on the unmerged API reference here).
- **`scripts/api-resolve.ts` (the proven-resolution draft) deleted** — its logic is captured here and in
  the P2/P4 findings; it will be rebuilt properly as the `LinkResolver` service in Phase 2 (no dead code).
- **2026-07-16 — Phase 3 complete; byte-identical gate PASSED (full corpus).** Decisions made:
  - **docLinks scope: per-package index** (matches gen-api's per-package map, required for the gate).
    Cross-package `{@link}` linking is a deliberate POST-gate enhancement, not a freebie.
  - **Index dedup: per resolved symbol, extraction order, last wins** — multi-namespace re-exports
    (two pages, one declaration) resolve to the last-extracted page, exactly as gen-api.
  - **Ambiguity: a location claimed by two different urls → `urlAt` none** (protects renderers from
    wrong links; upstream per-symbol dedup keeps legitimate duplicates out of this path).
  - **LinkResolver resolves module-scope declarations only** — parameters/locals/members share their
    statement's line and previously stole the enclosing export's page (caught by the gate on
    `FleetHealth.rollup`'s `{@link byNode}`).
  - **Model schema consts renamed camelCase** (`tag`/`source`/`symbol`/`entry`) per the house naming
    rule; the derived interfaces stay PascalCase.
  - **D4 realized as `scripts/gen-api-next.ts`** — writer copied verbatim; keep both scripts in sync
    until the Phase 5 cutover deletes the prototype.
- **2026-07-19 — Phase 4 complete (TypePrinter · Annotate · SourceRenderer · HoverRenderer).**
  Decisions made:
  - **Renderers = data + a pure transformer, not HTML assemblers.** Services produce `Link` ranges /
    `Part` runs; `Annotate.transformer` maps them onto the EXISTING shiki pipeline (D1 as locked).
    Phase 5 wires the transformer into `highlight.ts`/`gen-hovers.ts` — no custom renderer.
  - **Anchors are whole tokens** — shiki bakes leading whitespace into a token, and the token
    element becomes the `<a>`; parity with the old popup linkifier's whole-span wrapping.
  - **A declared type's synthesized self-reference has no symbol** (checker returns undefined from
    `getSymbolAtLocation`; nested references resolve fine). Consequences: type-alias hovers print
    the parsed RHS node; interface/class hovers show the bare self-name UNLINKED (also the right
    UX — a hover never links the symbol it describes).
  - **Reformatting keeps links via `Annotate.realign`** (character alignment, whitespace/separator
    elastic) — de-risks Phase 5's prettier-formatted popup types; none on real divergence, a
    dropped link over a wrong link.
