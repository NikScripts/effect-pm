# Storage correctness — you can’t get it wrong

**Status:** ENG (owner unlock 2026-07-15 — do A→D) — make storage composition fail-loud; silent empty journals are the enemy.  
**Related Eng:** Agent 3 is free after [#59](https://github.com/NikScripts/effect-pm/pull/59); this is the preferred next Log/Store lane (supersedes thin “child-runtime Logs.layer only”).  
**Not this plan:** store-layer `(scopeKey, lineId)` memo (still deferred); Agent D handles; docs-site chrome; Postgres backends.

**SSOT when unlocked:** this file. Narrative fill-in later lands in `docs/guides/stores.md` (placeholder today) + TSDoc. Standards already lock three persistence shapes (`docs/standards/storage.md`).

---

## Thesis

Apps “get storage wrong” today mostly by **wiring that typechecks and runs but records/reads the wrong journal** (or none). Fail-fast exists for **duplicate scope keys** and **unregistered engine scopes**. Almost everything else (provide vs provideMerge, merge order, missing `Node.logs` / `.store`, omitted SQLite `filename`, nested `Logs.layer`, dual `Store.Service` by accident) is **silent empty** or **split-brain**.

Goal: **wrong composition dies or warns at build/boot**; happy path is one recipe; intentional multi-node / two-copy logs stay allowed.

---

## What already works (do not undo)

| Defense | Where |
|---------|--------|
| `Store.Service.layerMemory` / `layer` bake `Logs.layer` + per-registration `_logs` tails | `src/Store.ts` |
| Private `_logs` (apps own the noun `log`) | [#57](https://github.com/NikScripts/effect-pm/pull/57) |
| Full-key `Logs.byResource(tag \| key)` | [#59](https://github.com/NikScripts/effect-pm/pull/59) |
| Capture logger closes over `LogRelay` (forked workers still publish) | `makeCaptureLogger` |
| `StoreDuplicateScopeKey` at registration time | `registrationNormalize.ts` |
| Engine `Storage` capture + `resolveOrDie` for missing scope | toolkit engines + `scopeBridge` |
| Override tests (app store into Process) | `process-store-default-override.test.ts` |
| Two durable copies (node + resource) intentional | `logs-two-copies-*`, `docs/LOGS.md` |
| Three persistence shapes + default vs `serviceOption` | `docs/standards/storage.md` |

**Intentionally allowed**

- One `Store.Service` per Node: many registrations, one journal/file.  
- Multi-node: N stores / N runtimes (`resource-web`).  
- Node journal + resource `_logs` copies of the same live line.  
- `Store.layerDefaultMemory` for engine event observability **without** the Logs platform.  
- `DurableQueueStore` / `ShardMap` / `HistoryStore(metrics)` as separate planes.

---

## Footgun ranking (highest leverage first)

| # | Footgun | Today | Target defense |
|---|---------|-------|----------------|
| **P0** | `Layer.provide(AppStore)` instead of `provideMerge` (toolkit already holds `layerDefaultMemory`) | Silent: engines keep ephemeral default; app SQLite/logs unused | Fail-fast boot check **or** eslint + fix all examples/README; one stores-guide recipe |
| **P0** | Wrong merge order → engine `Storage` bound to default while reads use AppStore | Split-brain; partial tests | Document Effect truth (self-wins); parametric tests both orders; optional assert at engine build |
| **P1** | Expect logs from `layerDefaultMemory` alone | Empty `by*` / `Resource.logs` | Explicit TSDoc + stores guide; optional strict `Logs.requireRelay` |
| **P1** | Missing `Node.logs` / toolkit `.store(tag)` | Empty durable queries | Strict mode: served/registered key set check; “empty ⇒ unregistered” troubleshooting |
| **P1** | `layer()` / `layer({})` without `filename` | Operator thinks SQLite | Require `layerMemory` for memory **or** warn; lint suspicious calls |
| **P2** | Nested / second `Logs.layer` or accidental second `Store.Service` in one Node | Two buses/journals | Dev singleton check **or** “never re-provide Logs when using Store.Service.layer*” rule + test |
| **P2** | `_logs` tails when `LogRelay` is `None` | Silent `Layer.empty` | For normal Service layers: prefer fail if registrations need logs but relay absent |
| **P2** | Wrong full key / key kind | Empty query | Optional warn if query key ∉ registration set |
| **P3** | Bare `Effect.log` without `withScope` | Live yes / resource durable no | Docs only |
| **P3** | Legacy docs citing `processId`/`queueId` / stale “one writer” | Confusion | Doc ripple (Agent 1 can own archive/legacy) |
| **—** | Store-layer lineId memo | Deferred | Out of scope until unlock |

Child-runtime inherit vs re-provide for `Logs.layer` is **folded into P2** (singleton / “one bake-in per Node runtime”), not a separate product track.

---

## Phased plan

### Phase A — Recipe SSOT (docs + examples) · owner unlock to execute

**Outcome:** One composition recipe that matches Effect merge semantics; examples don’t teach the footgun.

1. Fill `docs/guides/stores.md` (replace placeholder):  
   - `Store.Service` + `layerMemory` / `layer({ filename })`  
   - **Always** `resourceLayer.pipe(Layer.provideMerge(AppStore.layer…))`  
   - Why not bare `Layer.provide(AppStore)` when toolkit has `layerDefaultMemory`  
   - Filename presence; default memory ≠ logs platform  
   - One store per Node; multi-node = N stores  
   - Two log copies OK; product reads = `Resource.logs` / `Logs.by*`
2. Align README + `examples/resource-web` + dashboard/TUI examples with `provideMerge`.  
3. Rewrite any “later wins” cutover language to **app store must be present at engine layer build** (self-wins on conflict).

**Exit:** guides/stores is linkable SSOT; examples match. No runtime change required.

### Phase B — Hard guards (Eng) · unlock after A or in parallel if owner says so

**Outcome:** Common wrong wiring fails at layer build / first use.

| Guard | Sketch |
|-------|--------|
| **B1 — Storage identity / override** | When building Process/Queue with registrations expected, ambient `Storage` must resolve scopes that match; die with message pointing at `provideMerge(AppStore)`. Expand override tests to **both** merge orders + SQLite readback of a known row. |
| **B2 — Logs relay presence** | For `Store.Service.layer*` paths that register `_logs`, do not silently skip tails if bake-in failed; assert `LogRelay` present. Keep `layerOptional` as internal escape only. |
| **B3 — Filename / memory honesty** | `layer()` without `filename` either aliases clearly to memory-only API or emits a one-shot warning; prefer forcing `layerMemory` for ephemeral. |
| **B4 — Registration completeness (strict, opt-in first)** | Dev/strict: if a served tag’s `key` has no registration on ambient AppStore, fail or warn. Start opt-in (`Store.strict` / env) so existing demos don’t break. |

**Exit:** failing tests that used to be silent now fail for B1–B2; B3–B4 have owner-picked strictness.

### Phase C — One bus / one journal per Node runtime · unlock after B

**Outcome:** Accidental dual relay/store is hard.

1. Document: **do not** nest a second `Logs.layer` or second `Store.Service` inside the same Node ManagedRuntime.  
2. Optional dev check: same fiber/runtime already has `LogRelay` → refuse second `relayLayer` install (or reuse).  
3. Tests: dual-runtime isolation stays **allowed**; dual-store same runtime flagged.

This **is** the child-runtime rule, stated as storage correctness: inherit parent bake-in; never install a second platform journal by habit.

### Phase D — Query key hygiene · small

1. Optional: `byNode` / `byResource` warn when key not in Storage registration set.  
2. Finish legacy doc ripples still teaching bag / processId identity (Agent 1 corpus if preferred).

---

## Agent 3 assignment shape (when unlocked)

**Mode:** plan-first reply (tell owner everything) → stop for go → implement unlocked phase only.

Suggested first Eng bite after Phase A docs (or A+B together if owner wants code-first):

1. **B1 + example provideMerge fix** (highest silent damage).  
2. Then **B2**.  
3. Park C/D until owner picks singleton strictness.

Out of scope for Agent 3: handles (D), site UI, store memo, Postgres, `layerNoop` until a concrete ambient needs it.

---

## Owner unlock checklist

- [ ] Approve thesis (fail-loud over silent empty)  
- [ ] Approve intentional allows (two copies, multi-node N stores, default memory ≠ logs)  
- [ ] Unlock **Phase A** (docs/examples), **B** (guards), or **A+B**  
- [ ] B3: prefer force `layerMemory` vs warn-only?  
- [ ] B4: strict registration completeness opt-in or always-on in beta?  
- [ ] Phase C: refuse second `Logs.layer` in same runtime, or document-only?

---

## Success criteria

An app author who follows `guides/stores.md` cannot accidentally:

1. leave engines on `layerDefaultMemory` while reading AppStore, or  
2. think they have SQLite without a filename, or  
3. expect durable logs without `Node.logs` / `.store` without a clear empty/fail signal, or  
4. install two platform relays in one Node without meaning to.

Verification for Eng phases: `pnpm typecheck && pnpm test && pnpm lint` + new composition tests named for the footgun.

---

## Short prompt (paste when unlocked)

```
Checkout integration and pull.

Read docs/plans/storage-correctness.md and docs/handoffs/agent-status.md.

You are Agent 3. Focus: make storage composition something you can’t get wrong
(silent empty / split-brain journals). Store memo, handles, docs-site are out of scope.

FIRST REPLY — tell the owner everything before code:
  1. Restate thesis + P0/P1 footguns in your own words
  2. What already ships vs what you will change
  3. Proposed Phase A vs B bite for THIS unlock (owner will say which)
  4. Tests, docs touches, risks, out of scope
  5. STOP for go

Branch: cursor/storage-correctness-<slice>-a009 from integration.
```
