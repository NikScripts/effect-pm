# Docgen system — design doc (LIVING; we work from this)

Status: **ARCHITECTURE LOCKED (owner approved). Phase 1 (prototypes) in progress.**
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
