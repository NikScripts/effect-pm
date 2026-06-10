# Telemetry Step 5.2+ — transition / branch / emit (agent pickup)

> **Start here** for envelope + branch + op `.provide` work after owner bake (Jun 2026).

**Path:** `docs/handoffs/telemetry-step52-transition-handoff.md`  
**Branch:** `cursor/telemetry-redesign-bake-faed`  
**HEAD:** `c7f93f975` — 5.2b envelope ↔ op `.provide` + 5.4 emit hook stub  
**Gate:** `pnpm run typecheck && pnpm test && pnpm run lint`

| Doc | Role |
| --- | --- |
| **[state-transition-op-provide-bake.md](../recipes/state-transition-op-provide-bake.md)** | **SSoT** — two-tier branch model, dual API, steps 1–6 |
| [telemetry-requirements.md](../recipes/telemetry-requirements.md) | API SSoT — §9 emit, invariant 11 Changed |
| [telemetry-step5-emit-handoff.md](./telemetry-step5-emit-handoff.md) | Broader Step 5–6 (catalog, `internal/telemetry/`, runner) |
| [state-root-bake.md](../recipes/state-root-bake.md) | Envelope / snapshot vocabulary |

**Design validation tests (non-shipping spec):** `test/state-scope-lifecycle.validation.test.ts` — two-tier prototype, cleanup, parallel isolation.

---

## Branch checkpoint

| Step | Status | Commit / notes |
| --- | --- | --- |
| 1–4 Telemetry Tag / wiring / calling | ✅ | Through `d5e8c66ef` |
| **5.1** `State.Root` + COW `transition` + `previous` | ✅ | `21c2be3a3` |
| **5.2a** EmitPolicy markers + override decode | ✅ | `ecf70326e` — defer removed from override schema in 5.2b |
| **5.2b** Op `.provide` → envelope (`installLeaf` interim) | ✅ | `747c63a0b` — rename to **branch** in next step |
| **5.4 (stub)** `StateChangedEmitter` on `transition` | ✅ | `c7f93f975` — no materializer yet |
| **5.2c–5.3** Two-tier branch model + dual API + live read | ❌ | **Next** — see implementation order below |
| **5.5** `materializeSchema` → effective `Root.current` | ❌ | After branch stack |
| **5.6** OpFrameStack + transition frame fields | ❌ | |
| **6** Op runner + real `Telemetry.layer` | ❌ | |
| Kernel / D5 / hub debt | ❌ | Step 8+ |

**454 tests green** at last full run. **Typecheck must stay green** before merge.

---

## Design blockers — resolved (owner bake Jun 2026)

Do **not** re-litigate without owner approval:

1. **Two-tier state** — Tier 1 shared base (root author + extend, **no branch keys**); Tier 2 fiber **active branch stack**; **effective `current`** = merge for reads.
2. **Ops ≠ branches** — OpFrameStack independent of branch path; nested ops **share** one branch (refcount claim/release).
3. **`.current`** — one active branch path + ancestors; sibling branches **absent**, not empty.
4. **Terminology** — **branch** not leaf; `installBranch` / `patchBranch` / `clearBranch`.
5. **Dual API** — `Function.dual` + real **`Pipeable`** on scopes: `patchBranch(scope, partial)` ↔ `scope.pipe(patchBranch(partial))`.
6. **`patchBranch` anytime** — not frozen at op start; `Scope.patch` → `this.pipe(patchBranch(partial))`.
7. **Parallel runs** — fiber branch stacks, not shared-base branch keys.
8. **5.2c** — do **not** rewire `yield* Scope` to shared-base `installLeaf`; implement two-tier first.

---

## Code blockers — implement next (ordered)

### Phase A — Internal branch stack (`src/internal/state/`)

1. **`StateBranchStackRegistry`** — fiber-keyed active path; push/pop/patch frame; refcount per branch path optional at this layer (runner may own refcount).
2. **`StateRootRegistry`** — `LayerMap` or equivalent: **one base envelope per root scope id** (fixes global `StateRootRef` clash).
3. Rename **`installLeaf` / `clearLeaf`** → **`installBranch` / `clearBranch`** + add **`patchBranch`** (dual API). **No shims.**
4. **`makeScope`** — attach **`Pipeable.Prototype`**; implement **`Scope.patch`**, **`withBranch`**.
5. **`resolveEffectiveCurrent`** — wire `State.Root.current`, `currentSlice`, emit hook input.

**Tests:** extend `test/state-transition-provide.test.ts`; keep `test/state-scope-lifecycle.validation.test.ts` green.

### Phase B — Scope.run + materialize

6. **`Scope.run`** → `withBranch` (ensuring clear); sync effective view for static emit.
7. **`internal/store/telemetry.ts`** — `materializeSchema` reads **`(yield* State.Root).current`** (effective), not `yield* schema.scope`.

**Tests:** `test/process-store-telemetry-schema.test.ts`, queue/log facet emits.

### Phase C — Live read + runner prep

8. **`yield* Scope`** — read **effective** slice (not Context tree).
9. **Transition frame** — `transitionSeq`, `lastTransition`, `OpFrameStack` option on Tier 1 writes.
10. **`makeOpProvide`** — claim branch + refcount; align with runner order in bake Step 4.

**Tests:** `test/state-scope.test.ts` — update to **branch path semantics** (not full nested Context tree).

### Phase D — Runner (Step 6 handoff)

11. `internal/telemetry/` runner, real Changed materialize, `Telemetry.layer`.

---

## Interim code debt (known)

| Item | Location | Note |
| --- | --- | --- |
| `installLeaf` naming | `src/State.ts` | Rename in Phase A |
| Op `.provide` no refcount | `src/Telemetry.ts` | Phase C |
| `yield* Scope` = Context snapshot | `src/State.ts` `makeScope` | Phase C |
| Global `StateRootRef` | `src/State.ts` | Phase A registry |
| Emit hook stub only | `StateChangedEmitterTag` | Phase D materializer |

---

## Do not regress

- `EmitPolicyOverrideSchema` — **no `"defer"`** in config overrides (CHK-21).
- `Effectable.Prototype` for EventNode — **not** `Effectable.Class` + `override` (hangs on v4 beta).
- Invariant 11 — **`State.Changed`** via **`State.transition`**, not `yield*` at call sites.
- Pipe-only branch APIs without data-first form; fake `.pipe` without **`Pipeable`**.

---

## Suggested first PR for implementing agent

**Title:** Phase A — two-tier branch stack + dual API + registry

**Acceptance:**

- [ ] `installBranch(scope, values)` and `RunScope.pipe(installBranch(values))` same behavior
- [ ] `patchBranch` / `Scope.patch` live updates on fiber stack
- [ ] Parallel fibers: two `Run` branches isolated (see validation test pattern)
- [ ] `StateRootRegistry`: two root scopes → two base Refs
- [ ] Gate green; update handoff checkpoint when merged

---

## Owner doc delta (uncommitted in tree)

Commit before or with agent pickup PR:

- `docs/recipes/state-transition-op-provide-bake.md` (locked bake)
- This handoff
- `test/state-scope-lifecycle.validation.test.ts` (validation)

Other modified docs under `docs/` — review diff; do not treat as SSoT unless listed above.
