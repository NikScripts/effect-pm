# Phase A review — two-tier branch model

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Commit reviewed:** `027dfe033` — `feat(state): Phase A — two-tier branch model + dual branch API`  
**Reviewer:** owner bake session (Cursor)  
**Date:** 2026-06-10  
**SSoT:** [state-transition-op-provide-bake.md](../recipes/state-transition-op-provide-bake.md) · [telemetry-step52-transition-handoff.md](./telemetry-step52-transition-handoff.md)

**Gate at review:** `pnpm run typecheck && pnpm test && pnpm run lint` — **458 tests green**

---

## Verdict

**Land the core, finish Phase A before Phase B.**

The agent delivered the **spine** of the two-tier model correctly: fiber-local branch overlay, effective reads on `State.Root` / `currentSlice`, dual branch combinators, and tests that prove parallel isolation. Gates are green.

Phase A is **~70% complete** per handoff acceptance. Do **not** treat Phase A as done: `StateRootRegistry`, real `Pipeable` on scopes, and **scope-owned branch storage** (see §Architecture) are still open. There is also **behavior drift** on sibling branch coexistence vs locked bake.

Handoff checkpoint is **stale** (still cites HEAD `c7f93f975`).

---

## Handoff acceptance vs delivered

| Criterion | Status | Notes |
| --- | --- | --- |
| `installBranch(scope, v)` ↔ `scope.pipe(installBranch(v))` | ✅ | Covered in `test/state-transition-provide.test.ts` |
| `patchBranch` / `Scope.patch` live updates | ✅ | `Scope.patch` calls `patchBranch` directly — not `this.pipe(patchBranch(partial))` |
| Parallel fibers isolated | ✅ | `state-transition-provide.test.ts` + validation prototype |
| **`StateRootRegistry`** — two roots → two Refs | ❌ | Explicitly deferred in commit message |
| Gate green | ✅ | 458 tests |
| Handoff checkpoint updated | ❌ | |

---

## What is good

### `src/internal/state/branchStack.ts`

- Fiber-keyed stacks (`Effect.fiberId`), prune empty stacks — matches parallel-safe Tier 2.
- `installFrame` / `patchFrame` / `clearFrame` / `mergeBranches` — clear, small module.
- Tier-1 base untouched by branch install — tested (`previous` stays `null`).

### `src/State.ts`

- `Root.current` and `currentSlice` merge Tier 1 + fiber stack (effective read).
- `transition` stays Tier-1-only; emit hook receives **effective** `current`.
- `installLeaf` / `clearLeaf` removed; `installBranch` / `patchBranch` / `clearBranch` / `withBranch` exported with `Function.dual`.
- `withBranch` bracket uses `Effect.ensuring` — correct cleanup shape.

### `src/Telemetry.ts` + tests

- `makeOpProvide` → `installBranch` + `currentSlice` — op context matches effective slice.
- `test/state-transition-provide.test.ts` is the right shipping spec for this slice.

---

## Blockers / must fix (Phase A completion)

### 1. `StateRootRegistry` not implemented

**Handoff Phase A #2.** Global `StateRootRef` still one-per-runtime. Composing RunResource + Queue (or two root scopes) shares one base Ref — **clash**.

**Required before multi-facet runtime:** per root scope id envelope (LayerMap or equivalent).

---

### 2. Real `Pipeable` on `StateScope` — not done

**Bake lock:** every scope gets `Pipeable.Prototype`; `Scope.patch(partial)` → `this.pipe(patchBranch(partial))`.

**Today:** `scope.pipe(installBranch(...))` works via **`Function.dual` currying**, not scope `Pipeable`. `patch` is a direct call — acceptable interim, not locked shape.

---

### 3. Sibling branches can coexist — **bake violation**

**Bake:** effective `current` = **one active branch path**; sibling branches **absent**, not co-installed.

**Code:** `branchStack` allows multiple frames at different paths on one fiber.

**Test encodes violation:** `test/state-scope-lifecycle.validation.test.ts` — *"sibling leaf paths coexist until each is cleared"* expects `Entry` + `Worker` together.

**Impact:** Conflicts with union snapshot bake (wire should reject multi-branch). Queue (`Entry | DedupeKey`) needs exclusivity at install, not only at decode.

**Required:** decide and implement — e.g. `installBranch` at a root-level sibling path clears other root-level branch frames on that fiber; nested ancestor paths exempt.

---

### 4. `State.previous` / emit hook — not effective

**Bake:** `State.previous(scope)` symmetric to effective `yield* scope` for **current**.

**Today:** `previousSlice` reads Tier-1 `envelope.previous` only — **no branch overlay**. Emit hook merges stack into `current` only, not `previous`.

**Impact:** `State.Changed` materialize (Phase D) and union snapshot `previous`/`current` need **effective both sides** at flush. See owner bake #1 (union path variants).

---

### 5. Stale docs / terminology

| Location | Issue |
| --- | --- |
| `docs/handoffs/telemetry-step52-transition-handoff.md` | HEAD, checkpoint table stale |
| `src/Telemetry.ts` TSDoc ~L308, ~L598 | Still references `State.installLeaf` |
| `test/state-scope-lifecycle.validation.test.ts` | Describe blocks say `installLeaf` / `clearLeaf` |
| `src/State.ts` | `leafKeys` not renamed to `branchKeys` (bake terminology) |

---

## Expected deferrals (Phase B–D — do not block merge of spine)

| Item | Status |
| --- | --- |
| `yield* Scope` still reads Context nested tree | Phase C |
| `Scope.run` still `provide(layer)` not `withBranch` | Phase B |
| `op.provide` installs branch, does not clear / refcount | Phase C |
| `transitionSeq` / `lastTransition` / OpFrameStack | Phase C |
| Runner + real Changed materialize | Phase D |
| D5 `RunResourceSnapshotSchema` / union snapshot | Owner bake + migration |

Validation test *"Scope.run puts nested state in Context but not in envelope"* remains **accurate** until Phase B/C.

---

## Architecture — scope-owned branch data (owner requirement)

> **Imperative:** Each scope **owns** its branch data as the **single source of truth** for that segment. The old system achieved this naturally via Effect **dependencies** (`scope.layer` / Context). The two-tier redesign must preserve that invariant — not replace it with an anonymous path-keyed blob.

### Old model (Context as SSOT)

```text
GateScope.layer({ resourceId, concurrency })
  → Context provides typed GateScope

RunScope.layer({ runId }).pipe(Layer.provide(GateScope.layer(...)))
  → Context provides typed RunScope; parent required in R
  → makeState reads parent, inserts at path — nesting enforced by types
```

- **Identity:** scope **class/tag** owns the segment.
- **Typing:** `ValueOf<scope.Leaf>` at layer boundary.
- **Lifecycle:** Layer scope = lifetime; no global merge map.

### New model today (Phase A) — gap

```text
Tier 1 Ref          → root author + extend (per runtime, not per domain yet)
Tier 2 branchStack  → { path, values: Record<string, unknown> } per fiber
Effective current   → mergeBranches(base, stack)  // derived view
Context Service     → still makeState nested tree; NOT updated by installBranch
```

**Problems:**

1. **Dual representation** — branch values live in `branchStack` as untyped records; Context still holds a parallel nested tree from `layer()` / `Scope.run`. Bake rejects dual **write**; hybrid read remains until Phase C.
2. **Scope does not own storage** — `installBranch(scope, values)` writes to a **central fiber map keyed by path**, not to a cell owned by `RunScope` the service tag.
3. **No schema gate at write** — `Record<string, unknown>` bypasses `scope.Leaf` validation on install/patch.
4. **Merge mistaken for SSOT** — `mergeBranches` is a **read model**; it must not become the authority authors mutate.

### Target invariant (lock for Phase A completion + Phase C)

| Layer | Owner | SSOT | Writers |
| --- | --- | --- | --- |
| **Root author + extend** | Root scope tag (`RunResourceScope`) | Tier-1 envelope Ref (per domain via `StateRootRegistry`) | `State.transition` only |
| **Branch author fields** | Branch scope tag (`RunScope`, `EntryScope`, …) | **Per (fiber, scopeId)** branch cell — not anonymous path bag | `installBranch` / `patchBranch` / `clearBranch` for **that scope only** |
| **Effective `current`** | *(none — derived)* | Merge of Tier-1 + active branch chain | **Read-only**; materializer / `yield* Scope` (Phase C) |

**Concrete requirements for implementing agent:**

1. **Branch frame identity = scope id**, not just `path: string[]` — path is derived from scope; canonical key is `scope.id` (or `{ rootId, path }`).
2. **Typed leaf at boundary** — `installBranch(scope, leaf: ValueOf<scope.Leaf>)` and `patchBranch(scope, partial: Partial<...>)`; decode with `scope.Leaf` on write.
3. **Single writer per scope segment** — only that scope's combinators mutate its cell; runner claim/refcount orchestrates lifetime, not alternate stores.
4. **`mergeBranches` is projection only** — document and enforce; never persist merge output back as Tier-1 write.
5. **Phase C:** `yield* RunScope` reads **branch cell / currentSlice**, not stale Context nested tree — Context requirement for branch scopes during ops may reduce to **claim marker** or go away; **data** comes from branch SSOT.
6. **Reject** reintroducing dual write (Context tree + envelope both authoritative for author fields).

### Migration from dependencies

```text
Before:  RunScope.layer({ runId })  → Context SSOT
After:   op.provide({ runId })      → installBranch(RunScope, { runId })  → RunScope-owned cell SSOT
         yield* RunScope             → read RunScope cell (effective slice)
         Scope.run                   → withBranch(RunScope, leaf, body)  → same SSOT, bracketed
```

Parent scope in Context (`Requirements | Id`) may remain for **composition / requirements** until fully replaced by explicit `withBranch` brackets — but **values** must not live only in parent Context merge.

---

## Suggested fix order (implementing agent)

1. Update handoff checkpoint to `027dfe033` + partial Phase A status.
2. **`StateRootRegistry`** — per root scope id Tier-1 Ref.
3. **Scope-owned branch cells** — scope id + `Leaf` schema validation; path derived.
4. **Single active path** — sibling exclusivity on install.
5. **`Pipeable`** on `makeScope` + `Scope.patch` → `this.pipe(patchBranch(partial))`.
6. **Effective `previous`** — overlay branch stack on materialize for `State.previous` + emit hook both sides.
7. Stale TSDoc / test describe renames.
8. **Phase B:** `Scope.run` → `withBranch`; `makeOpProvide` ensuring clear (or refcount stub).

---

## Test notes

| Test | Note |
| --- | --- |
| `test/state-transition-provide.test.ts` | **Keep** — primary Phase A shipping spec |
| `test/state-scope-lifecycle.validation.test.ts` | Update sibling coexist test when exclusivity lands; rename `installLeaf` describes |
| `test/state-scope.test.ts` | Still valid until Phase C Context rewire |

---

## Index

- Issue register: [telemetry-branch-issues.md](./telemetry-branch-issues.md) — ISSUE-035 (scope-owned branch SSOT)
- Primary handoff: [telemetry-step52-transition-handoff.md](./telemetry-step52-transition-handoff.md)
