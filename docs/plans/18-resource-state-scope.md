# 18 — Resource state scope system (`State.Scope`)

**Status:** design only (May 2026). **Not implemented.**

Defines **scope / state / context** for effect-pm kernels. **Facet telemetry** that reads
scope is [17-facet-telemetry-factory.md](./17-facet-telemetry-factory.md) §5 — implement
**together** in plan 17 **slice 3** (`ProcessExecutionStore` + `ProcessScope` + `Process.ts`).

---

## 0. Vocabulary

| Term | Meaning |
|------|---------|
| **Scope** | `class` extending `State.Scope` / `Parent.withState` — service tag + DI chain |
| **State** | Leaf **`Schema.Struct`** for this level only (schema value on the class) |
| **Context** | Assembled value for `yield* Scope` — ancestors at root, children under `withState` keys |

Not Effect’s `Context` module — use **scope context** in prose; types use `State.Scope.Context<S>`.

---

## 1. Declaration & assembly (Effect Schema)

Leaf state is an **Effect `Schema.Struct`** passed as the **second argument** to
`State.Scope()` / `withState` (plain `Struct.Fields` — factory wraps scope-field metadata;
see plan 17 §5.2). **Not** a separate TS `interface` plus a duplicate schema.

```ts
class ProcessScope extends State.Scope(
  {
    processId: Schema.String,
    scheduleKey: Schema.NullOr(Schema.String),
    startedAt: Schema.Number,
    isStartupRun: Schema.Boolean,
  },
)("@nikscripts/effect-pm/process/ProcessScope") {}

class RunScope extends RunResourceScope.withState(
  "Run",
  { runId: Schema.String },
)("@nikscripts/effect-pm/run/RunScope") {}

class EntryScope extends WorkerScope.withState(
  "Entry",
  {
    entryId: Schema.String,
    key: Schema.String,
    priority: Schema.Number,
  },
)("@nikscripts/effect-pm/queue/EntryScope") {}
```

| On scope class | Meaning |
|----------------|---------|
| **`EntryScope.State`** | Leaf **`Schema.Struct`** (the struct schema, not a runtime value). |
| **`EntryScope.Context`** | **`Schema.Struct`** for `yield* EntryScope` (codegen from `withState` chain). |
| **`EntryScope.Schema.entryId`** | Property schema from `State` + scope pickup metadata (factory-attached). |

Types: `Schema.Schema.Type<typeof EntryScope.State>` (leaf value), `Schema.Schema.Type<typeof EntryScope.Context>` (context value).

| Scope | Context (`yield* Scope`) |
|-------|---------------------------|
| `ProcessScope` | `{ processId, scheduleKey, startedAt, isStartupRun }` |
| `RunResourceScope` | `{ resourceId }` |
| `RunScope` | `{ resourceId, Run: { runId } }` |
| `WorkerScope` | `{ queueId, Worker: { workerId } }` |
| `EntryScope` | `{ queueId, Worker: { workerId, Entry: { … } } }` |

**`withState` key:** must not collide with existing property names on parent Context (compile error).

**No single “full” type** — use `State.Scope.Context<typeof EntryScope>` only where `EntryScope` is provided.

---

## 2. DI: generated `layer` (authors never hand-merge)

```ts
RunScope.layer(state): Layer<RunScope, never, RunResourceScope>
// make: const parent = yield* RunResourceScope; return { ...parent, Run: state }
```

Public on each scope class (v1):

- `layer(state)` / `provide(state)` — `effect.pipe(Effect.provide(layer(state)))`
- `run(state, effect)` — bracket sugar (= `provide`); use for **fiber-long** or **tick** subtrees (e.g. `WorkerScope.run`, `ProcessScope.run`)

---

## 3. Runtime toolkit (when to use what)

| Form | When | Pattern |
|------|------|---------|
| **A — Lifetime** | Factory / runtime body | `factory.pipe(Effect.provide(RootScope.layer(...)))` |
| **B — Program** | Named `Effect.gen` unit | `program.pipe(Effect.provide(ChildScope.layer(state)))` at end |
| **C — Combinator** | `acquireUseRelease`, `matchEffect` | `() => executeRun(...)` where `executeRun` uses **B** |
| **D — Fiber** | Worker loop | `WorkerScope.run(state, Effect.forever(...))` or `.pipe(Effect.provide(WorkerScope.layer))` |
| **`run`** | Readable bracket (optional) | `ProcessScope.run(tickState, matchEffect(...))` |

**Anti-patterns:** manual `Layer.effect` chains at call sites; nested `provide` copying full state blobs; `provide` inside combinator callbacks without a named effect.

---

## 4. Integration order (with plan 17)

| Slice | Scope work | Telemetry (plan 17) |
|-------|------------|---------------------|
| **1** | `State.Scope` factory + tests | — |
| **2** | — | Factory core (no kernel) |
| **3** | **`ProcessScope` + `ProcessScope.run`** | **`ProcessExecutionStore` + `Process.ts` §5.5** — **one PR** |
| **4+** | Per facet in §10 of plan 17 | Same PR as each facet |

**Not first:** full Queue scope tree (slice 7). **Not first:** RunResource-only scope without facet (scope is proven in slice 3 with execution telemetry).

### 4.1 Process (slice 3 — coupled)

Kernel target is plan 17 **§5.5** — `ProcessScope.run` + `Execution.Completed` / `Failed(error)`.
Tick **State** includes fields known before user effect; `completedAt` / `error` come from
`Clock` + `Failed(error)` arg inside **generated** emit (not re-provided scope blobs).

### 4.2 RunResource (slice 6)

`RunResourceScope` lifetime **A**; per call `RunScope` **B** + **C** (`executeRun` + `acquireUseRelease`).
Facet event `Telemetry.Schema` reads `RunScope` when Run facet migrates.

### 4.3 Queue (slice 7)

`QueueScope` **A** on `makeQueueRuntime`; `WorkerScope.run` **D** on worker loop; `EntryScope` **B** on `executeItem`.

---

## 5. Success criteria

- `State.Scope` + `withState` codegen; collision errors on bad keys.
- Slice 3: `Process.ts` uses `ProcessScope.run` + plan 17 emit tree (no `finishInput` / execution `RuntimeEmitContext` for row fields).
- Queue chain typechecks before Queue kernel migration.
