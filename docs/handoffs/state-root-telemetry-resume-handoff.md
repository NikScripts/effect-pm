# State.Root + telemetry resume — implementer handoff

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Audience:** telemetry implementation agent  
**Date:** Jun 2026 (owner bake session)  
**Read with:** [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md) (Steps 1–8) and [telemetry-requirements.md](../recipes/telemetry-requirements.md)

---

## Purpose

Owner locked **`State.Root`** (process-state envelope) during bake. This doc tells you **what to continue**, **what to pause**, and **patterns to stop using** before you resume after Step 3a.

**Do not implement Step 5–6** (runtime / materialize / kernel migration) until **`State.Root` lands in `src/State.ts`** per §2 below.

---

## Current branch status (critical review)

| Area | Status | Notes |
| --- | --- | --- |
| R1–R4 RunResource domain + `Tags.ts` | ✅ Done | `RunResource` is `Context.Service`; kernel attaches factory statics |
| Step 1a/1b `Telemetry.Schema` + `Telemetry.Tag` | ✅ Good | `.Struct`, wire ids, node handles — keep |
| Step 2 `RunResourceTelemetry` Tag port | ⚠️ Partial | Tag + schemas work; **debt coexists** in same file (`defineEvent`, `RunResourceHubTelemetry`) |
| Step 3a wiring value layer | ⚠️ Skeleton only | Builders + collector ok; **`PlainFields` stub**; **`Telemetry.layer` is discard stub** |
| Step 3b PlainFields + `test-d.ts` | ❌ Not started | **Safe to resume here** |
| Step 4 calling API | ❌ Not started | **Safe to resume** (minor scope typing may adjust after `State.Root`) |
| Step 5–6 runtime + kernel | ❌ Blocked | **Wait for `State.Root` in `State.ts`** |
| `store/RunResourceTelemetry` export subpath | ❌ Missing | Step 0 gap — add when facet module splits |
| `src/internal/store/telemetry.ts` duplicate DSL | ❌ Open | Merge/dedup when wiring runtime lands |
| Kernel `stateRef` + hub emits | ❌ Debt | Delete in Step 8 **after** runtime + `State.Root` |

**Gate today:** `pnpm run typecheck && pnpm test && pnpm run lint` — 412 tests green. That does **not** validate materialize, exhaustiveness, or emit behavior yet.

---

## §1 — Resume order

### Continue now

1. **Step 3b** — `PlainFields` / `RequiredBindMap` / strict `WiringConfig<Tag>`; `test/telemetry-wiring.test-d.ts` with real `@ts-expect-error` cases (requirements § Step 3).
2. **Step 4** — Tag calling paths, `.provide(scopeLeaf)`, `OperationContext` stub, no-op when facet `.layer` absent.

### Pause until `State.Root` ships

- **`src/internal/telemetry/`** (materialize, runner, telemetry-state Refs)
- **`Telemetry.layer` real implementation** (beyond discard stub)
- **Kernel migration** off `Ref<RunResourceState>` / `RunResourceHubTelemetry`
- **`State.Changed` wiring binds** for `previous` / `current` / transition `reason` (materialize from envelope — see §2)
- **Deleting** `RunResourceState.ts` or rewiring snapshot schema (D5 — §4)

### Do not copy into production wiring/docs

The Step 3a test and requirements doc still show **scratch transition fields**:

```ts
// WRONG — do not implement; owner rejected this model
Telemetry.state.from((s) => s.pendingPreviousSnapshot)
Telemetry.state.from((s) => s.pendingCurrentSnapshot)
Telemetry.state.from((s) => s.pendingReasonWire)
```

Replace mentally with **`State.Root.previous` / `State.Root.current`** at materialize time (§2). Step 3b tests may use **placeholder** binds for plain-field exhaustiveness on other events; **do not** add `pending*` fields to extend or scope.

---

## §2 — `State.Root` (locked — implement in `src/State.ts`)

### What it is

When you declare:

```ts
class RunResourceScope extends State.Scope(RunResource)({
  resourceId: Schema.String,
}) {}
```

the factory **auto-creates an internal envelope** — **`State.Root`** — per scope instance (one per gate/worker, **not** shared global state).

Authors **never declare** the envelope class. They **never** `layer()` envelope fields manually.

### Envelope shape (runtime)

Top-level object (no wrapper field):

```ts
{
  // spread from optional domain tag static (see §3)
  version?: "0.1.0",
  author?: "Nikolas Stow",

  previous: null | CurrentShape,
  current: {
    // author scope fields + Telemetry.extend + withLeaf nests
    resourceId: string,
    waiting?: number,
    Run?: { runId: string },
  },
}
```

| Field | Source | Author writable? |
| --- | --- | --- |
| Keys from tag **`static Root`** | Copied at init from domain tag | **No** (frozen at layer) |
| **`previous`** | Transition machinery (`State.Changed`) | **No** |
| **`current`** | Scope + extend + withLeaf | **Yes** (normal scope/extend APIs) |

**No auto `metadata` property.** If authors want `{ metadata: { … } }`, they put it **inside** `static Root` themselves.

### Yield semantics (unchanged from plan 18)

| Expression | Yields |
| --- | --- |
| `yield* RunResourceScope` | Current scope view (author tree under `current`) |
| `yield* RunScope` | Nested scope view (same rules as today) |
| `yield* State.Root` | **Full envelope** — **internal only** |

**Do not** add a yieldable **`RunResource.Root`** on the domain tag for live state. Domain tag optional static is **`RunResource.Root`** (plain object) — **same name, different thing**: static JSON config, not a Context service.

### Context id

Derive from domain tag, e.g. `` `${RunResource.key}/Root` `` → `@nikscripts/effect-pm/RunResource/Root`.

Only package internals (`internal/telemetry`, transition emit) **`yield* State.Root`**. Public/kernel code continues to **`yield* RunResourceScope`** / **`RunScope`** for author fields.

### `State.Scope` registration

First `State.Scope(domainTag)(fields)` for a domain:

1. Registers author scope Context tags (unchanged).
2. Registers **`State.Root`** Context service for that domain scope tree.
3. `RunResourceScope.layer({ resourceId })` initializes envelope: `previous: null`, `current: { resourceId, … }`, optional spread from `RunResource.Root` static.

String-id scopes (`State.Scope("@test/…")`) — **no envelope** (test/legacy path); domain-tag scopes get envelope.

### `State.Changed` materialize (after runtime lands)

At transition emit, materializer reads **`yield* State.Root`**:

- Wire `previous` ← `root.previous`
- Wire `current` ← `root.current`
- Transition machinery sets `root.previous` / updates `root.current` — **not** scratch fields on extend

Wire shape for `previous`/`current` is a **projection of `current`’s shape** (helper TBD — D5); interim **`RunResourceStateSchema`** stays until projection helper exists.

### Implementation acceptance (`State.Root` slice)

- [ ] `State.Scope(RunResource)({ … })` creates envelope service; `layer` initializes `previous`/`current`
- [ ] Optional `static Root` on domain tag spread onto envelope top level; omitted when absent
- [ ] `RootMetadata` type forbids `previous` / `current` keys on static object
- [ ] `yield* RunResourceScope` unchanged; `yield* State.Root` returns full envelope in tests
- [ ] String-id scopes unchanged (no envelope)

---

## §3 — Domain tag `static Root` (optional, manual)

Each domain tag **may** define:

```ts
export class RunResource extends Context.Service<RunResource, RunResourceApi>()(
  "@nikscripts/effect-pm/RunResource",
) {
  /** Optional — copied onto State.Root at layer time. Plain JSON; no Schema required. */
  static readonly Root = {
    version: "0.1.0",
    author: "Nikolas Stow",
  } as const satisfies RootMetadata;
}
```

| Rule | Lock |
| --- | --- |
| **Optional** | `State.Scope(RunResource)(…)` compiles with or without static `Root` |
| **Type** | `RootMetadata` — JSON-safe; **`version: string` required** when present; **`previous` / `current` forbidden** |
| **Runtime** | Spread onto envelope top level at init; frozen thereafter |
| **Manual** | Implementer adds per domain; factory does not invent defaults |

Use **`version: "0.1.0"`** (or similar) for wire/drift — **not** a separate `"alpha"` stability channel on the tag.

---

## §4 — D5 / `RunResourceState.ts` (interim)

- **`src/store/RunResourceState.ts`** is **interim debt**, not locked final design.
- File header “D5 lock” is **stale** — owner reopened D5.
- **`RunResourceStateChanged`** schema may keep importing `RunResourceStateSchema` until:
  1. `State.Root` exists, and
  2. A helper projects wire `previous`/`current` from `current` shape (or nested `Telemetry.Schema`).

Do **not** invest in expanding the hand-maintained snapshot struct; do **not** add kernel/scratch fields to mirror it.

---

## §5 — Step 3a review (keep / fix)

### Keep

- `Telemetry.extend`, `Telemetry.bind(handle, fields).pipe(…)`, `Telemetry.metric.*`
- `Telemetry.state.from`, `Telemetry.source.*`
- `Wiring.sections` collector
- `Telemetry.layer` / `Telemetry.withLayer` **stubs** (document as 3a; replace in Step 6)

### Fix when touching wiring tests/docs

- Remove `pendingPreviousSnapshot` / `pendingCurrentSnapshot` / `pendingReasonWire` from **`test/telemetry-wiring.test.ts`** once Step 3b adds real exhaustiveness tests (or mark `State.Changed` bind as TODO blocked on `State.Root`).
- Do **not** update requirements doc scratch-field examples until owner merges bake edits — treat this handoff as override for `State.Changed` binds.

### Step 3b — `Telemetry.bind` type safety (locked Jun 2026)

**Option 1:** each `Telemetry.Schema` class carries precomputed **`_bindFields`**
(derived from author `fields` at class definition). `Telemetry.bind(handle, fields)`
requires `fields` assignable to **`handle.schema._bindFields`** via handle inference
— **not** `satisfies`, not lazy `BindFields<SchemaFieldsOf<S>>` in the parameter.

Nested `Schema.Struct` and nested `Telemetry.Schema` recurse in `_bindFields` at
definition time. Wire shape unchanged.

**Implementer:** strict negative cases in `test/telemetry-wiring.test-d.ts`
(wrong nested key, missing inner field, typo top-level key).

**Prerequisite:** `StateScope.withLeaf` return type must use
`StateFieldSelectors<ChildFields>` in `InsertSelectors` (interface + impl aligned)
so nested `Schema.State.*` selectors stay typed as {@link StateFieldSelector}, not
plain wire `Schema.*`.

---

## §6 — File layout reminders

Target (unchanged from requirements):

```text
src/Telemetry.ts
src/store/RunResourceTelemetry.ts           — Tag + schemas (split debt later)
src/store/RunResourceTelemetry.wiring.ts    — satisfies WiringConfig<Tag>
src/store/RunResourceTelemetry.service.ts   — facet layer
src/internal/telemetry/                     — Step 5+ (blocked)
src/State.ts                                — add State.Root envelope (before Step 5)
```

Add **`store/RunResourceTelemetry`** to `package.json` exports when module splits.

---

## §7 — Explicit non-goals for next PRs

- No kernel `stateRef` removal until runtime exists
- No `defineEvent` / hub helper deletion until Step 8
- No `ProcessStore` internal telemetry DSL merge in the same PR as `PlainFields` unless scoped separately
- No `pending*` telemetry scratch fields anywhere new

---

## §8 — Questions → owner

Escalate before coding if unclear:

1. Exact **`RootMetadata`** `version` format (semver string only vs also allow integer schema version key inside `Root`).
2. **`State.Changed` `reason`** — literal wire string from transition vs bind from telemetry state.
3. Whether **`State.Root`** Context id is always `` `${domain.key}/Root` `` or includes scope segment.

---

## Read order (resume)

1. **This doc** (State.Root + pause/resume)
2. [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md)
3. [telemetry-requirements.md](../recipes/telemetry-requirements.md) — **except** `State.Changed` bind example with `pending*` (superseded by §1 here)
4. [21-state-vocabulary.md](../plans/21-state-vocabulary.md)

**Gate before every push:** `pnpm run typecheck && pnpm test && pnpm run lint`
