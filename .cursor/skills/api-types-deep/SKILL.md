---
name: api-surface
description: >-
  Detailed answers focused on real API signatures and TypeScript types. Use when
  the user wants type-level detail, signature dumps, error/requirement channels,
  hover-accurate shapes, designing or inventing APIs, "what does X return",
  "show the API", or mentions api-surface / types deep dive.
---

# API surface (types-first detail)

Detailed, type-first answers about APIs — shipped or proposed. Not a short product
summary. Prose comments on the types; it does not replace them.

## Default posture (overrides concise chat habits)

- Be **thorough** on types and contracts. Expand. Do not compress away signatures.
- Lead with types in fenced `ts` blocks.
- **Existing APIs:** open source before answering. Copy or faithfully reconstruct
  from tip — do not invent generics, error channels, or Layer requirements for
  symbols that already exist.
- **Inventing / designing APIs** (common): invent freely. Still write full
  signatures, type parameters, `A` / `E` / `R`, and call-site hover shapes. Mark
  proposed vs existing. Fit neighbouring modules and Effect idioms; read those
  for precedent.

## What to open (existing surface)

Until the answer is grounded:

1. Public module (`src/Name.ts`, package exports / subpath).
2. Internal impl only to explain behavior the public type already exposes —
   quote the public type as the contract.
3. Type tests (`*.test-d.ts`) for hover / assignability.
4. Runtime tests for error tags / Exit shapes when failure channels matter.
5. `examples/` for call-site ergonomics.
6. Vendored Effect (`repos/effect/packages/effect/src/` or pinned
   `node_modules/effect`) for Effect types — not v3 memory.
7. Living docs to name the feature; **types win** if docs disagree.

## Answer shape

For each symbol or call:

1. **Identity** — module path, export name, subpath
   (`import * as X from "hyperlink-ts/X"`). Say `proposed` when inventing.
2. **Signature** — full TypeScript form as in source (or the proposed `export`).
   Include type parameters and constraints.
3. **Channels** — success `A`, error `E` (tags / unions), requirements `R`.
4. **Key types** — Tag, Handle, Spec, Schema fields, brands, associated
   `namespace` types. Expand nested objects one level when they matter.
5. **Overloads** — each overload and when it applies; do not collapse them.
6. **Ergonomics** — what `yield*` / pipe / `Layer.provide` sees (hover, not impl).
7. **Sharp edges** — `never` traps, missing registrations, local/remote Handle
   sameness, variance — when the types show them.

Cite paths (and line ranges when helpful). For proposals, cite the precedent file
you mirrored.

## Depth rules

- Nested Effect / platform types: one symbol deep by default; name the rest
  (`Scope`, `FileSystem`) unless asked to expand.
- Hyperlink public surface: expand Tag / Handle / Spec / store registration when
  relevant.
- Error `_tag` unions from source, tests, or the proposed design — not stringly
  message paraphrases.
- Local vs remote: prove shared Handle type from the type when the API does that.
- Twoslash cuts hide harness — recover full types from `src/` (or state them in
  the proposal).

## Anti-patterns

- Capability bullets without a signature ("you can pause the queue").
- Treating memory of old names (`QueueResource`, `effect-pm`, Effect v3) as tip
  without checking.
- Hand-waving proposed types ("basically T") instead of writing the signature.
- Short verdict-only replies while this skill is active.
- Editing or tip-syncing unless the user asked.

## Activation

Cues: "api-surface", "show the types", "what's the signature", "error channel",
"what does yield\* get", "Layer requirements", "hover type", "type-level",
"design the API", "propose a signature", or a detailed API/type walkthrough.

If they also want a short summary: type dump first, then a brief recap.
