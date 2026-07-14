# ShardMap — type-safety remediation (for the ShardMap author)

**Owner of the code:** Cursor Agent (authored `src/ShardMap.ts` + `src/internal/shardMap*`; active on
`cursor/intro-shardmap-trio`, `cursor/shardmap-store`).
**Found by:** Agent C standards audit. This doc is the complete spec — you shouldn't need the audit chat.
**Branch:** your ShardMap working branch; fix these before the next merge to `integration`.

---

## Verdict

`ShardMap` isn't wrong, it's **undisciplined**. It's a fully-generic public facade
(`layer`/`serve`/`serveRemote` over `<Self, Key, Value, Error>`) bolted onto a **deliberately erased
engine** (`internal.EngineTag`, `buildImpl(): Record<string, unknown>`), bridged by ~20 `as unknown as`
casts — **none of which carry the proof comment the corpus requires**. And the erasure is very likely
**avoidable**: `Telemetry` (see `src/Telemetry.ts`) is the same shape of resource facade and needs
**zero** casts because its `buildImpl` is generic and returns a typed impl. Match that.

## Findings

### 1. `no-since-until-1-0` (must) — 13 illegal `@since 1.0.0`
The surface is pre-1.0/fluid; a `@since` is an unapproved lock. Remove all 13 in `src/ShardMap.ts`
(a doc comment ends at its visibility marker `@public`).

### 2. `types-and-naming.fix-root-cause` + `boundary-cast-last-resort` (must) — ~20 unjustified casts
Two things are wrong with these, and both must be fixed:

**(a) The erasure is probably avoidable — fix the root.** These dissolve if the engine is generic:
```
src/ShardMap.ts:328,361,401   internal.buildImpl(tag as unknown as internal.EngineTag, options)
src/ShardMap.ts:332,365       impl as unknown as Resource.ImplOf<…> / ServeImplOf<…>
src/ShardMap.ts:295,335,401   … as ShardMapTag<…> / as Layer.Layer<…> / as Effect.Effect<…>
```
Make `internal.buildImpl` generic over `<Self, Key, Value, Error>`, taking the typed `ShardMapTag`
and returning `Resource.ImplOf<ShardMapSpecOf<Key, Value, Error>>` (thread the generics through the
engine, exactly as `Telemetry.buildImpl` does). The cast-in / cast-back at all three verbs then goes
away. Do a short spike first to find how much of the `Record<string, unknown>` impl can be threaded
vs. what is genuinely irreducible.

**(b) Any cast that genuinely survives keeps ONE `// SAFE:` proof.** `boundary-cast-last-resort`
permits a cast **only** at a type-level boundary TS truly can't express, **provably safe, with a
one-line reason**. The engine's general comment does not count — each surviving cast carries its own
justification, or it's a violation. Applies to the engine-internal ones too:
```
src/internal/shardMap.ts:101,102,106   tag as ResourceTag<unknown, Resource.Spec>
src/internal/shardMap.ts:122,214,223   peer as unknown as PeerLeaf
```

### 3. Minor / clearly avoidable
- `src/ShardMap.ts:117` — `(schemas.error ?? Schema.Never) as Error | typeof Schema.Never`. This is a
  local typing issue on the `??`, not a boundary. Type it, don't cast it.
- `src/internal/shardMap.ts:214,223` — re-cast `peer as unknown as PeerLeaf` inline; route them through
  the existing `peerAt` helper (`:120`) so the cast lives in one place (and gets one proof).

## Acceptance criteria

- No `as` / `as unknown as` in `src/ShardMap.ts` + `src/internal/shardMap*` **except** documented
  boundary casts, each with a one-line `// SAFE:` proof. Verify:
  `rg -n 'as unknown as| as [A-Z]' src/ShardMap.ts src/internal/shardMap*`.
- 13 `@since` gone.
- `pnpm typecheck` (tsgo) 0 errors · `effect-language-service diagnostics --file` clean on the changed
  files · ShardMap tests green (`test/telemetry-and-shardmap.test.ts` + any SQL/shard tests).
- A `*.test-d.ts` pinning the public `layer`/`serve`/`serveRemote` return types with **no casts** — the
  proof the facade is honestly typed end-to-end.

## Not yet covered

Agent C's pass focused on the cast pattern + `@since` (what makes ShardMap differ from the clean
`Telemetry`). A full naming / doc-comment / resource-pattern sweep of all four files
(`ShardMap.ts`, `internal/shardMap.ts`, `internal/shardMapSql.ts`, `internal/shardMapSymbols.ts`)
has **not** been done — do it (or ask Agent C to) before calling ShardMap corpus-complete.
