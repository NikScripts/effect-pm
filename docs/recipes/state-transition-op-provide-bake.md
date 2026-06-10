# State.transition + op `.provide` — bake recipe

**Status:** Steps 1–6 locked; **two-tier branch model + dual API** locked Jun 2026.  
**Goal:** Lock envelope writes, scope reads, branch lifecycle, and op `.provide(branchValues)` so `State.Changed` materializes from one effective `current` view.  
**Handoff:** [telemetry-step52-transition-handoff.md](../handoffs/telemetry-step52-transition-handoff.md)

**Related:** [state-root-bake.md](./state-root-bake.md), [telemetry-requirements.md](./telemetry-requirements.md) (invariant 11), Step 5.1 `src/State.ts`, Step 4 `makeOpProvide` in `src/Telemetry.ts`.

---

## Mise en place

| Fact | Source |
| --- | --- |
| **5.1 landed** | `StateRootRef` + `State.transition` COW + `State.previous(scope)` |
| **5.2a landed** | `EmitPolicy` markers + override decode |
| **5.2b landed** | `installLeaf` / `clearLeaf` / `currentSlice` + op `.provide` → envelope (rename → **branch** API below) |
| **Gap** | Two-tier model, branch stack, dual API, `Scope.patch`, per-domain registry |
| **Changed wire** | `operation` from OpFrameStack; fan-out from `State.transition`, not `yield*` |

---

## Terminology (locked Jun 2026)

| Term | Meaning |
| --- | --- |
| **Branch** | A `withLeaf` segment on the active state path (`Run`, `Entry`, …). Replaces “leaf” in API names. |
| **Branch values** | Author fields at that segment (`{ runId }`, `{ entryId }`, …). |
| **Active path** | Shared base + **one** branch chain (ancestors + one terminal branch). Sibling branches **absent** from `current`, not empty. |
| **Op frame** | Telemetry/runner metadata (`operation`, start/exit, flush). **Not** a state-tree node. |

**Type helpers:** `State.Type.Branch<S>` (was `Leaf`), `branchKeys` on scope views (was `leafKeys`).

---

## Two-tier state (locked Jun 2026)

Ops and scopes are **not 1:1**. Op nesting and branch nesting are **independent**.

```text
Tier 1 — shared base (per domain, StateRootRegistry)
  root author fields + extend siblings only
  NO branch keys (Run, Entry, …)
  writer: State.transition only

Tier 2 — fiber active branch stack (StateBranchStackRegistry)
  one active path overlay per fiber
  writer: installBranch / patchBranch / clearBranch
  parallel-safe: each fiber has its own stack

Read model
  effectiveCurrent = merge(sharedBase, activeBranchPath(fiber))
  yield* Scope / State.Root.current / materialize → effectiveCurrent
```

### Ops vs branches

| Stack | Purpose | Nesting |
| --- | --- | --- |
| **OpFrameStack** | Wire `operation`, runner order, Changed flush | Many ops deep |
| **Active branch stack** | State path visible to `yield* Scope` | `withLeaf` hierarchy only |

Nested ops may **share one branch** (e.g. five ops on the same `RunScope`). Use **claim/release** (refcount per branch path per fiber): `installBranch` on first claim, `clearBranch` when last claim releases — not install/clear on every op push/pop.

### `.current` shape

**Not** a combined tree of all possible branches. **Effective `current`** = shared base fields + **one** active branch path (direct ancestors + terminal branch segment).

```ts
// While EntryScope is active:
{ queueId: "q-1", Entry: { entryId: "e-1" } }

// Five nested ops, same RunScope — still one branch:
{ resourceId: "r1", concurrency: 4, inFlight: 1, Run: { runId: "run-9" } }
```

### Mid-scope updates (locked)

Branch values are **live for the whole claim bracket**, not frozen at op start:

- **`installBranch(scope, values)`** / **`scope.pipe(installBranch(values))`** — initial segment when scope is first claimed
- **`patchBranch(scope, partial)`** / **`scope.pipe(patchBranch(partial))`** / **`yield* Scope.patch(partial)`** — **any time** while claimed
- **`State.transition`** — shared extend / root counters only (Tier 1)

---

## Dual API — scope-first or `scope.pipe` (locked Jun 2026)

Branch combinators use Effect **`Function.dual`**: **scope-first call** and **pipe-friendly** call are the **same** implementation. **Real `Pipeable`** on every `StateScope` — **`Pipeable.pipeArguments` / `Pipeable.Prototype`**, not a hand-rolled fake `.pipe`.

```ts
import { patchBranch, installBranch, clearBranch, withBranch } from "…"; // or State.*

// Data-first (scope as first arg) — always valid
yield* patchBranch(RunScope, { runId: "updated" });
yield* installBranch(RunScope, { runId: "run-1" });
yield* clearBranch(RunScope);

// Pipe-friendly (scope is receiver) — same semantics
yield* RunScope.pipe(patchBranch({ runId: "updated" }));
yield* RunScope.pipe(installBranch({ runId: "run-1" }));
yield* RunScope.pipe(clearBranch());

// Bracket
yield* withBranch(RunScope, { runId: "run-1" }, bodyEffect);
yield* RunScope.pipe(withBranch({ runId: "run-1" }, bodyEffect));
```

**`Scope.patch(partial)`** — sugar for **`this.pipe(patchBranch(partial))`** (real pipe on the scope instance).

**Effect-level** combinators dual on **`Effect`** as first arg where applicable:

```ts
program.pipe(State.record((timeline) => { /* … */ }));
yield* State.record(program, (timeline) => { /* … */ }); // data-first, same impl
```

| Combinator | Data-first | Pipe |
| --- | --- | --- |
| **`installBranch`** | `installBranch(scope, values)` | `scope.pipe(installBranch(values))` |
| **`patchBranch`** | `patchBranch(scope, partial)` | `scope.pipe(patchBranch(partial))` |
| **`clearBranch`** | `clearBranch(scope)` | `scope.pipe(clearBranch())` |
| **`withBranch`** | `withBranch(scope, values, effect)` | `scope.pipe(withBranch(values, effect))` |
| **`State.record`** | `State.record(effect, fn)` | `effect.pipe(State.record(fn))` |

**Implementation:** each combinator = **`dual(arity, (scope, …) => Effect)`**; **`makeScope`** attaches **`Pipeable.Prototype`** (or equivalent) so `scope.pipe` is the standard Effect pipe, not a one-off method.

**Rejected:** scope-only pipe form without data-first; fake `.pipe` that does not go through **`Pipeable`**.

---

## Locked ingredients

### Step 1 — Single writer + effective read

- **Tier 1** `StateRootRegistry` — one base envelope **per root scope id** (not one global Ref).
- **Tier 2** `StateBranchStackRegistry` — fiber-keyed active path overlay.
- **`op.provide(branchValues)`** — claims branch (refcount); does **not** mutate via `scope.layer` Context tree.
- **`yield* Scope`** — filtered read from **effective** `current` (live).
- **`OperationContext.scope`** — same after `.provide`.
- **Rejected:** dual write (Context tree + envelope as parallel sources of truth).

### Step 2 — Install / patch / clear branches

- **`installBranch(values)`** — dual: `installBranch(scope, values)` ↔ `scope.pipe(installBranch(values))`.
- **`patchBranch(partial)`** — dual; **`Scope.patch(partial)`** → `this.pipe(patchBranch(partial))`.
- **`clearBranch()`** — dual: `clearBranch(scope)` ↔ `scope.pipe(clearBranch())`.
- **`withBranch(values, effect)`** — dual bracket for `Scope.run` / static emit.
- **Extend fields** — Tier 1 `State.transition` only.
- **Nested ops, same scope** — refcount; no clear until last op frame releases scope.
- **Re-provide / replace** — overwrite branch values at path.

**Interim names in tree:** `installLeaf` / `clearLeaf` rename to branch API in same change set (no shims).

### Step 3 — Transition frame

- **Every Tier 1 COW write** updates **`lastTransition: { id, operation }`** + **`transitionSeq`** on base envelope.
- **`operation`** — from **OpFrameStack** when present: `` `${namespace}/${opPath.join("/")}` ``; else facet namespace.
- **OpFrameStack** — `src/internal/telemetry/`; optional via `Effect.serviceOption`.
- **Debounced emit** — flush uses **`lastTransition` at flush time**.

### Envelope read model

**`yield* State.Root`** (internal):

```ts
type RootRead = RootMetadata & {
  readonly previous: BaseCurrent | null;   // Tier 1 only — no branch keys
  readonly current: EffectiveCurrent;     // merge(base, fiber active path)
  readonly transitionSeq: bigint;
  readonly lastTransition: { readonly id: string; readonly operation: string };
};
```

- **`static Root`** keys at envelope top level beside `previous` / `current`.
- **`State.previous(scope)`** — filtered slice of **`previous` base** + branch rules symmetric to `yield* scope` for **current**.

---

### Step 4 — Runner order + Changed flush

```text
pushOpFrame
→ installBranch (if first claim for op scope)
→ emit Start
→ body (patchBranch anytime)
→ exit legs
→ metrics (State.transition on Tier 1)
→ flush pending Changed   // effective current still has branch
→ clearBranch (if last claim)
→ popOpFrame
```

**Flush before `clearBranch`** so Changed snapshots include the branch segment and final extend counters.

---

### Step 5 — Typed field changes

- **`State.changes()`** — diff **`previous` → `current`** on **effective** snapshots (exclude `RootMetadata` + internal keys).
- **Paths typed** per root scope: `State.Type.Paths<typeof RunResourceScope>`.
- **`State.changes(scope)`** — filter; **`path` stays full dotted** for emit policy.
- Branch path segments in diffs (e.g. **`Run.runId`**).

### Step 6 — Record timeline without telemetry

- **Opt-in** — `Effect.serviceOption` pattern; no cost when absent.
- **Primary UX (effect pipe):**

```ts
const result = yield* program.pipe(
  State.record((timeline) => { /* … */ }),
);
```

- **`State.record(callback)`** — dual on effect: `effect.pipe(State.record(fn))` ↔ `State.record(effect, fn)`.
- Entry shape: `{ at, id, operation, changes }` per transition on Tier 1 (and effective view for branch paths in diff).
- **Telemetry unchanged** — separate from router / `State.Changed`.

---

## Recommended (handoff)

```text
pushOpFrame → installBranch? → start → body → exit → metrics → flush Changed
→ clearBranch? → popOpFrame
```

(`installBranch?` / `clearBranch?` — only when claim refcount crosses 0↔1.)

---

## Open / not baked here

- Exact `StateBranchStackRegistry` module path (`src/internal/state/`)
- Scope Context markers after branch read rewire (delete vs facade)
- Full router integration test (Step 6 runner)

---

## Rejected substitutions

- Dual write (Context tree + envelope independently).
- `yield* State.Changed` at call sites (invariant 11).
- Branch keys on shared Tier 1 base (parallel conflict).
- Combined `current` with all sibling branches populated.
- Op frame push/pop 1:1 with branch install/clear.
- Pipe-only branch APIs with no data-first scope form.
- Fake `.pipe` (not **`Pipeable.pipeArguments`**).
