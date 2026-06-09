# State.Root + telemetry — primary implementer handoff

**Path:** `docs/handoffs/state-root-telemetry-resume-handoff.md`  
**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Audience:** telemetry / RunResource implementation agent  
**Updated:** Jun 2026 (owner bake + EventNode review)

**Read with:**

| Doc | Use for |
| --- | --- |
| [telemetry-requirements.md](../recipes/telemetry-requirements.md) | API SSoT, Steps 1–8, calling invariants |
| [state-root-bake.md](../recipes/state-root-bake.md) | Locked snapshot / envelope model (steps 1–7) |
| [telemetry-branch-issues.md](./telemetry-branch-issues.md) | Full issue register (mirrors §9 below) |
| [run-resource-service-handoff.md](./run-resource-service-handoff.md) | RunResource tag/kernel split (R1–R6) |
| [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md) | Original step order |

**Gate before every push:** `pnpm run typecheck && pnpm test && pnpm run lint`  
(Full `pnpm run build` may OOM on unrelated dts debt; ISSUE-001 deterministic key is fixed.)

---

## Purpose

Owner locked **`State.Root`** (process-state envelope) and nested **`RunResourceSnapshotSchema`** during bake. This doc is the **single resume point**: what to build next, what to pause, patterns to reject, and **all open issues**.

**Do not implement Step 5–6** (runtime / materialize / kernel migration) until **`State.Root` lands in `src/State.ts`** (§4).

---

## Event emission model (locked)

| Kind | Trigger | Call site |
| --- | --- | --- |
| **Middle events** | **`yield*`** inside op body | `yield* ctx.telemetry.Retried` |
| **Root-scoped events** | **`yield*`** when root ambient | `yield* RunResourceTelemetry.State.Changed` |
| **Start / exit legs** | **Operation runner** on op entry/exit | **Do not yield** — runner emits `Telemetry.start` / `Telemetry.exit` legs |

- Events are **zero-arg `Effect` values** — not functions (`Changed()` rejected).
- **`yield* eventHandle`** is what triggers emit once Step 6 runtime is wired.
- Materializer builds wire payload from scope, op input, wiring `bind`, terminals, and (for `State.Changed`) **`State.Root` envelope** — no hand-built objects at call sites.

**Today on branch:** `yield*` compiles and runs; emit is a **no-op** until `Telemetry.layer` + operation runner land (Step 6). Step 4 stub must not throw when facet `.layer` absent.

---

## EventNode mechanism (Effect v4 — locked preference)

Each event handle must be **yieldable** and carry **`{ wire, path, schema, EventNodeTypeId }`**.

**Preferred — `Effectable.Prototype`** (same as Effect v4 `Config`, `Statement`, `Activity`):

```ts
const EventNodeProto = {
  ...Effectable.Prototype<EventNode<S>>({
    label: "EventNode",
    evaluate() {
      return noopEmit(); // Step 6: materialize + TelemetryRouter fan-out
    },
  }),
  [EventNodeTypeId]: EventNodeTypeId,
};

const makeEventNode = (...): EventNode<S> => {
  const self = Object.create(EventNodeProto);
  self.wire = telemetryWireId(...);
  self.path = path;
  self.schema = schema;
  return self;
};
```

| Approach | Verdict |
| --- | --- |
| **`Effectable.Prototype` + `Object.create`** | **Preferred** — idiomatic v4; Step 6 swaps `evaluate`; cast-free via annotated factory return |
| **`Effectable.Prototype` + object spread** | Equivalent (Activity pattern) |
| **`Effectable.Class` + `override`** | **Rejected** — v4 Base `evaluate` returns `this`; hangs (verified empirically) |
| **`Object.assign(Effect.sync(noop), meta)`** | **Last resort only** — works today in staged `makeEventNode`; migrate to Prototype |

**Note:** Vendored `repos/effect` shows v3 `commit()` API — **stale**. Shipped package is `effect@4.0.0-beta.76`.

**Action:** Migrate `src/Telemetry.ts` `makeEventNode` from last-resort `Object.assign` to Prototype when touching Step 4.

---

## Current branch status

| Area | Status | Notes |
| --- | --- | --- |
| R1–R6 RunResource tag/kernel split | ✅ Done | `RunResource.ts` tag-only; `RunResourceModule.ts` barrel; ISSUE-001 fixed |
| Step 1a/1b `Telemetry.Schema` + `Telemetry.Tag` | ✅ Good | `.Struct`, wire ids, node handles |
| Step 2 `RunResourceTelemetry` Tag port | ⚠️ Partial | Correct tree L260+; **debt:** `defineEvent`, `RunResourceHubTelemetry` same file |
| Step 3a wiring value layer | ⚠️ Skeleton | Builders + collector ok; **`PlainFields` stub**; **`Telemetry.layer` discard stub** |
| Step 3b PlainFields + `test-d.ts` | ❌ Not started | **Resume here** |
| Step 4 calling API | ⚠️ Partial | `EventNode` staged (migrate to Prototype); missing op builder, `.provide`, `OperationContext` |
| Step 5–6 runtime + kernel | ❌ Blocked | **Wait for `State.Root` in `State.ts`** |
| `State.Root` envelope | ❌ Not started | Bake locked — §4 |
| Nested snapshot schema (D5) | ❌ Not started | 8-file checklist in state-root-bake § step 7 |
| `store/RunResourceTelemetry` export subpath | ❌ Missing | Step 0 gap |
| Kernel `stateRef` + hub emits | ❌ Debt | Step 8 after runtime |

**412 tests green** on typecheck/test/lint — does **not** validate materialize, exhaustiveness, or real emit.

---

## §1 — Resume order

### Continue now

1. **Step 3b** — `PlainFields` / `RequiredBindMap` / strict `WiringConfig<Tag>`; `Telemetry.BindShape<S>`; `test/telemetry-wiring.test-d.ts` negative cases.
2. **Step 4** — Migrate `makeEventNode` → **`Effectable.Prototype`**; Tag calling paths; `.provide(scopeLeaf)`; `OperationContext`; no-op when facet `.layer` absent.
3. **D5 snapshot migration** — can precede `State.Root` if hub emits nested shapes first (state-root-bake § step 7).

### Pause until `State.Root` ships

- `src/internal/telemetry/` (materialize, runner, telemetry-state)
- **`Telemetry.layer` real implementation**
- Kernel migration off `Ref<RunResourceState>` / `RunResourceHubTelemetry`
- **`State.Changed` auto-materialize** from envelope (no bind map for `previous`/`current`/`id`/`reason`)
- Bake step 8 markers (`Telemetry.transition.*`, `Telemetry.envelope.*`, `Telemetry.nodeLog`) — owner paused

### Do not copy into production

```ts
// WRONG — owner rejected
Telemetry.state.from((s) => s.pendingPreviousSnapshot)
Telemetry.state.from((s) => s.pendingCurrentSnapshot)
Telemetry.state.from((s) => s.pendingReasonWire)
```

Requirements doc may still show scratch examples until cleaned — **this handoff overrides** for `State.Changed`.

---

## §2 — Working tree changes (uncommitted)

Review with `git diff` before commit. Highlights:

### Code

| Path | Change |
| --- | --- |
| `src/RunResource.ts` | Tag-only class (`@nikscripts/effect-pm/RunResource`) |
| `src/RunResourceModule.ts` | **New** — public factory barrel |
| `src/internal/runResource/service.ts` | Types + `RunResourceApi` only (no class) |
| `src/internal/runResource/kernel.ts` | Impl + `Object.assign(RunResource, runResourceApi)` |
| `src/Telemetry.ts` | `EventNode`, `makeEventNode`, `Telemetry.BindShape`, bind symbol; staged `Object.assign(sync)` |
| `src/Tags.ts`, `package.json`, `tsup.config.ts` | `./RunResource` → `RunResourceModule` |
| `src/store/RunResourceTelemetry.ts` | Minor import path fix |
| `test/telemetry-wiring.test-d.ts` | Partial bind-shape tests |

### Docs (owner bake)

| Path | Change |
| --- | --- |
| `docs/recipes/state-root-bake.md` | **New** — State.Root + snapshot bake SSoT |
| `docs/recipes/telemetry-requirements.md` | Nested D5, EventNode Step 4, invariants, change log |
| `docs/handoffs/telemetry-branch-issues.md` | **New** — issue register |
| `docs/handoffs/run-resource-service-handoff.md` | R1–R6 status, tag/barrel split |
| `docs/plans/21-state-vocabulary.md` | Envelope / extend alignment |
| `docs/recipes/telemetry-split-bake.md` | Cross-refs |

---

## §3 — `State.Root` (locked — implement in `src/State.ts`)

When:

```ts
class RunResourceScope extends State.Scope(RunResource)({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}
```

factory **auto-creates** internal **`State.Root`** envelope per scope instance.

### Envelope shape

```ts
{
  // optional spread from domain tag static Root
  version?: string,
  author?: string,
  previous: null | CurrentShape,
  current: CurrentShape, // nested — see state-root-bake
}
```

### Yield semantics

| Expression | Yields |
| --- | --- |
| `yield* RunResourceScope` | Process-filtered **current** view |
| `yield* RunScope` | Leaf **current** slice |
| **`yield* State.previous(scope)`** | Process-filtered **previous** slice (or `null`) |
| `yield* State.Root` | Full envelope — **internal only** |

**Context id (likely):** `` `${RunResource.key}/Root` `` → `@nikscripts/effect-pm/RunResource/Root` — confirm with owner if multi-scope domains differ.

### `State.Changed` materialize (Step 6+)

- Wire `previous` / `current` from **`yield* State.Root`** (nested snapshot)
- **`id`, `reason`** — auto from **`State.transition` frame** (not bind map)
- **`changedAt`** — terminal
- Transition: one **`Ref.modify`**, COW `previous = structuredClone(current)`, update `current`, emit

**Acceptance:** see checklist in [state-root-bake.md](../recipes/state-root-bake.md) and §7 below.

---

## §4 — D5 / `RunResourceSnapshotSchema` (locked)

**SSoT:** [state-root-bake.md](../recipes/state-root-bake.md) § Canonical schemas.

- Rename exports → **`RunResourceSnapshot` / `RunResourceSnapshotSchema`**
- **Delete** flat `RunResourceStateSchema` — **no shims**
- **`concurrency`** on `RunResourceScope` (author field)
- **Drop `observedAt`** from snapshot — event uses **`changedAt`**
- Store: replace hand-rolled flat decode with **`Schema.decodeUnknownOption(RunResourceSnapshotSchema)`**
- **8-file migration checklist:** state-root-bake § Recipe step 7

Can land **before** `State.Root` if emit path produces nested JSON first.

---

## §5 — Step 3a / 3b notes

### Keep

- `Telemetry.extend`, `Telemetry.bind(handle, fields).pipe(…)`, `Telemetry.metric.*`
- `Telemetry.state.from`, `Telemetry.source.*`
- `Wiring.sections` collector
- `Telemetry.layer` / `Telemetry.withLayer` **stubs** until Step 6

### Step 3b bind typing (locked)

- Bind shape precomputed at `Telemetry.Schema` definition (internal symbol)
- Public escape hatch: **`Telemetry.BindShape<S>`**
- Prerequisite: `StateScope.withLeaf` → `StateFieldSelectors<ChildFields>` for nested selectors

---

## §6 — File layout target

```text
src/Telemetry.ts
src/store/RunResourceTelemetry.ts           — Tag + schemas (split debt)
src/store/RunResourceTelemetry.wiring.ts    — satisfies WiringConfig<Tag>  ← missing
src/store/RunResourceTelemetry.service.ts   — facet layer                  ← missing
src/internal/telemetry/                     — Step 5+ (blocked)
src/State.ts                                — State.Root envelope (before Step 5)
```

Add **`store/RunResourceTelemetry`** to `package.json` exports when module splits.

---

## §7 — Implementation acceptance checklists

### `State.Root`

- [ ] `State.Scope(RunResource)({ … })` creates envelope; `layer` initializes `previous`/`current`
- [ ] Optional `static Root` on domain tag spread at init; `RootMetadata` forbids `previous`/`current`
- [ ] `yield* RunResourceScope` unchanged; `yield* State.Root` returns full envelope in tests
- [ ] `State.previous(RunResourceScope)` / `State.previous(RunScope)` filtered slices
- [ ] String-id scopes unchanged (no envelope)

### Step 4 / EventNode

- [ ] `makeEventNode` uses **`Effectable.Prototype`** (not Class; not assign-first)
- [ ] `yield* RunResourceTelemetry.State.Changed` no-op before facet `.layer`
- [ ] Op builder + `.provide(scopeLeaf)` + `OperationContext` stub

### Step 6 (after State.Root)

- [ ] `evaluate` materializes + routes via `TelemetryRouter`
- [ ] Runner emits start/exit; kernel uses Tag ops/events (not `RunResourceHubTelemetry`)

---

## §8 — Explicit non-goals (next PRs)

- No kernel `stateRef` removal until runtime exists
- No `defineEvent` / hub helper deletion until Step 8
- No `pending*` scratch fields anywhere new
- No ProcessStore internal DSL merge in same PR as PlainFields unless scoped

---

## §9 — Issue register (all open work)

Full detail: [telemetry-branch-issues.md](./telemetry-branch-issues.md). Triage before claiming a step done.

### P0 — Blockers / wrong runtime path

| ID | Issue | Status |
| --- | --- | --- |
| **ISSUE-001** | Build deterministic service key (`RunResource`) | ✅ **Fixed** — tag in `src/RunResource.ts`, barrel `RunResourceModule.ts` |
| **ISSUE-002** | Main barrel exports legacy ProcessStore `Telemetry` DSL | ❌ Open |
| **ISSUE-003** | Kernel uses rejected emit (`RunResourceHubTelemetry` + payloads) | ❌ Open — Step 8 |
| **ISSUE-004** | `defineEvent` / `RunResourceHubTelemetry` still public | ❌ Open — Step 8 |
| **ISSUE-005** | CHK-17: missing `RunResourceTelemetry.wiring.ts` + `satisfies` | ❌ Open |
| **ISSUE-007** | Queue/other facets use flat group-level events | ❌ Open — Slice E |
| **ISSUE-008** | `Telemetry.operation<Input>` generic not implemented | ❌ Open — Step 4 |
| **ISSUE-009** | Nested scope-inheriting ops (`rateLimit`) not implemented | ❌ Open — Step 4 |
| **ISSUE-010** | Step 4 calling API incomplete | ⚠️ Partial — EventNode only |
| **ISSUE-011** | Wiring test missing `onSuccess` bind for `Completed` | ❌ Open — Step 3b |
| **ISSUE-012** | `State.Changed` binds vs auto-materialize | ⏸️ Blocked on `State.Root` + step 8 markers |
| **ISSUE-017** | `State.Root` not in `src/State.ts` | ❌ Open — blocks Step 5–6 |

### P1 — Spec / layout / types

| ID | Issue | Status |
| --- | --- | --- |
| **ISSUE-013** | Missing `store/RunResourceTelemetry` export subpath | ❌ Open |
| **ISSUE-014** | Module split (wiring + service files) | ❌ Open |
| **ISSUE-015** | `WiringConfig` missing `tag` field | ❌ Open |
| **ISSUE-016** | `Telemetry.layer` not paired with Tag | ❌ Open — Step 6 |
| **ISSUE-018** | Duplicate `Telemetry.Schema` in `internal/store/telemetry.ts` | ❌ Open |
| **ISSUE-019** | `Telemetry.annotateLogs` pipe leg missing | ❌ Open |
| **ISSUE-020** | Field source naming drift (`source.*` vs spec prose) | ❌ Open |
| **ISSUE-021** | `test-d.ts` incomplete negative cases | ❌ Open — Step 3b |
| **ISSUE-022** | `Telemetry.BindShape<S>` staged, not fully gated | ⚠️ Partial |
| **ISSUE-023** | Schema `Telemetry.input` ≠ operation input (document) | ℹ️ Clarify in docs |
| **ISSUE-024** | `RunResourceStateChanged.id` plain string — align with transition | ❌ Open |
| **ISSUE-034** | **`makeEventNode` still uses `Object.assign(sync)`** | ❌ Migrate to Prototype |

### P2 — Docs / hygiene

| ID | Issue | Status |
| --- | --- | --- |
| **ISSUE-025** | Handoff status tables stale | ⚠️ This doc supersedes |
| **ISSUE-026** | Requirements implementation checklist open | ❌ Open |
| **ISSUE-027** | Requirements wiring example uses rejected `pending*` fields | ❌ Open |
| **ISSUE-028** | Invalid `rateLimit` syntax in requirements/bake docs | ❌ Open |
| **ISSUE-029** | Stale “loosely typed bind” comment in `Telemetry.ts` | ❌ Open |
| **ISSUE-030** | Recon docs show flat `Telemetry.event("Started")` | ❌ Open |
| **ISSUE-031** | No changeset for public telemetry API | ❌ Open — needs approval |
| **ISSUE-033** | CHK-16 router rename incomplete (`TelemetryHub` debt) | ❌ Open |

### Reference (correct)

| ID | Note |
| --- | --- |
| **ISSUE-006** | `RunResourceTelemetry.ts` Tag tree L260–272 is **correct** reference |

### Suggested fix order

1. ~~ISSUE-001~~ ✅  
2. ISSUE-005, 011, 014, 021, 022 — Step 3b wiring + types  
3. ISSUE-034, 010, 008, 009 — Step 4 EventNode + calling API  
4. ISSUE-017 — `State.Root` in `State.ts`  
5. D5 snapshot migration (8-file checklist)  
6. ISSUE-003, 004, 007 — kernel + debt + Queue migration (Step 6–8)  
7. ISSUE-027, 028, 030 — doc cleanup  

---

## §10 — Open questions → owner

Escalate before coding if unclear:

| # | Question | Status |
| --- | --- | --- |
| 1 | **`RootMetadata.version`** format — semver string only vs integer schema version key | **Open** |
| 2 | **`State.Changed.reason`** — bind vs auto | **Resolved** — auto from `State.transition` frame |
| 3 | **`State.Root` Context id** — always `` `${domain.key}/Root` `` vs scope segment | **Open** |
| 4 | Bake step 8 — transition/envelope markers + `Telemetry.nodeLog` | **Paused** — owner approval pending |
| 5 | Bake steps 9–10 — `State.transition` API, `Run` nest lifecycle | **Not baked** |

---

## Read order (resume)

1. **This doc**
2. [state-root-bake.md](../recipes/state-root-bake.md)
3. [telemetry-requirements.md](../recipes/telemetry-requirements.md)
4. [telemetry-branch-issues.md](./telemetry-branch-issues.md)
5. [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md)
6. [21-state-vocabulary.md](../plans/21-state-vocabulary.md)
