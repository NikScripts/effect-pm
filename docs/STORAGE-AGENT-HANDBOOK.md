# Storage integration agent handbook

**How to use:** Share this file with an agent and say **“Do Part B”** (or C, D, …). The agent must read **Part A** first, then only the assigned part.

---

## Target architecture (read this before any part)

**`ProcessStore` is not a storage service.** It must become **only a layer combiner** — a convenience `Layer` that merges facet layers (and optionally in-memory `RuntimeStorage`). It is **not** a `Context.Service`, **not** an `append` / `events` facade, and **not** a place to hang query namespaces like `ProcessStore.runtime`.

### What exists today (legacy — do not extend)

The repo still has transitional code that violates the target:

| Legacy (remove) | Problem |
|-----------------|--------|
| `ProcessStore` `Context.Service` + `ProcessStoreInterface` | Monolithic facade; encourages raw `append` |
| `yield* ProcessStore`, `store.append`, `getProcessExecutions` | Bypasses facets |
| `ProcessStore.runtime.*` / `ProcessStore.runResource.*` on the namespace | Queries belong on **`ProcessStoreRuntime`** facet tag, not on combiner |
| `assembleProcessStoreInterface` / `makeProcessStoreFromRuntimeStorage` | Re-builds monolith from facets |
| `RuntimeObserver.layerFromProcessStore` | Observer depends on monolith tag |

**If you are Part B, C, D, E, … — do not “fix” this by adding more to `ProcessStore.ts`. That digs a deeper hole.**

### What we are building toward

```
RuntimeStorage                    ← port (records)
    ↑
    ├── ProcessStoreGroupLog      ← Context.Service + layerRuntimeStorage
    ├── ProcessStoreQueueResource ← Context.Service + layerRuntimeStorage
    ├── ProcessStoreRuntime       ← **public** `src/ProcessStoreRuntime.ts` + layerRuntimeStorage (Part B)
    ├── ProcessStoreProcessExecution  ← (Part C)
    ├── ProcessStoreProcessLifecycle  ← (Part D)
    └── …

ProcessStore.layerRuntimeStorage  ← Layer.mergeAll(facet layers only)
ProcessStore.layer                ← Layer.provide(layerRuntimeStorage, RuntimeStorage.layer)
layerProcessStore (sqlite)        ← Layer.provide(ProcessStore.layerRuntimeStorage, sqlite RuntimeStorage)
```

**Domain modules** call **`Effect.serviceOption(FacetTag)`** then **`facet.value.method(...)`** — never `ProcessStore`, never namespace wrapper functions.

**Facet namespace exports layers only.** Each facet’s `export namespace FacetName` may export **`layerRuntimeStorage`** and **`layer`** — nothing else. **Forbidden:** `Effect.flatMap(FacetTag, (s) => s.method(...))` boilerplate (see `ProcessStoreQueueResource` lines 535–597 — **scheduled for removal**, do not copy).

**Correct usage:**

```ts
const runtime = yield* ProcessStoreRuntime;
yield* runtime.facts(query);

const qr = yield* Effect.serviceOption(ProcessStoreQueueResource);
if (Option.isSome(qr)) yield* qr.value.entryEnqueued(input);
```

**Spine** (`internal/store/spine.ts`) stays **internal** — shared encode/project helpers for facets, not a public API.

**Only Part P** may shrink/remove the legacy `ProcessStore` service and `ProcessStoreInterface`. Other parts work on **their facet file** + **call sites**, not on growing the combiner module.

---

**Scope:** Stay strictly within the assigned part’s files and concerns. Do not refactor unrelated modules, widen exports, or “drive-by” fix other letters.

**Files off limits unless your part says so:**

| File | Who may edit |
|------|----------------|
| `src/ProcessStore.ts` | **Part P only** (demolition / layer combiner). Parts B–O: **do not edit**. |
| `src/internal/store/composite.ts`, `assembleProcessStoreInterface` | **Part P** (+ **Part R** for spine helpers). |
| Other `src/internal/store/<facet>.ts` | The part that owns that facet (B→runtime, C→processExecution, …). |

**Git:** Work on the **current branch** in the existing workspace. **Do not** create a new branch, open a pull request, or run release/publish steps unless the maintainer asks.

**Workflow for every part (except A and Z):**

1. **Refactor first** — assigned module(s) to the standards in Part A. Assume the current code was written by a careless agent; you can do better. Fix types, Effect wiring, TSDoc, tests, and in-scope docs **without cheats**.
2. **Run verification** — `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build` (see below).
3. **Report** — reply to the maintainer with:
   - **Changes made** — what you refactored, why, and which files touched (brief but complete).
   - **Proposed storage API** — facet design for this module (see Part A). **Do not implement the new facet yet** unless the maintainer approves or edits the proposal.
4. **Build (only after approval)** — implement the facet, migrate off legacy `append`, add tests, update docs in scope.

**Mandatory reading before any part:** [STORAGE.md](./STORAGE.md), [ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md](./ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md), [AGENTS.md](./AGENTS.md), `.cursor/rules/public-vs-internal.mdc`.

**Verification (every part):**

```bash
pnpm typecheck    # both tsconfig.json and tsconfig.src.strict-effect-provide.json
pnpm test
pnpm lint
pnpm build
```

---

## Index — pick one letter

| Part | Scope | Status today |
|------|--------|--------------|
| **A** | **Charter** — standards, invariants, workflow (read first) | — |
| **B** | `RuntimeState` / `RuntimeObserver` + public **`src/ProcessStoreRuntime.ts`** | Merge facet layer in combiner; delete `ProcessStore.runtime`; **no** namespace wrappers |
| **C** | `Process.ts` + **`ProcessExecution`** facet | Do **not** edit `ProcessStore.ts` |
| **D** | `ProcessGroup.ts` + **`ProcessLifecycle`** facet | Do **not** edit `ProcessStore.ts` |
| **E** | `RunResource.ts` | Observer only; persistence via legacy observer layer |
| **F** | `HttpClientRunGate.ts` | No storage |
| **G** | `HttpApiResource.ts` | No storage |
| **H** | `Resource.ts` | No storage (confirm N/A or minimal hooks) |
| **I** | `Polling.ts` | No telemetry |
| **J** | `ProcessSchedule.ts` | No telemetry |
| **K** | `QueueResource.ts` + remove `ProcessStoreQueueResource` namespace wrappers | Tests: `yield* ProcessStoreQueueResource` then `.method()` |
| **L** | `Logs.ts` + `internal/manager/log*` | **Modern** — verification pass |
| **M** | `ProcessManager.ts` operator log reads | **Modern** — extend filters/queries |
| **N** | Legacy **`storage/file`** + `ProcessStore.file` | Deprecated NDJSON path |
| **O** | **`prisma/*`** + `storage/prisma` | Removed placeholder — rebuild on `RuntimeStorage` |
| **P** | **Demolish** legacy `ProcessStore` service → **layer combiner only** | Monolith still present |
| **Q** | `storage/sqlite` | `layerProcessStore`; surface `SqlError` vs `orDie` |
| **R** | `internal/store/*` spine/codec/composite | Shared facet infrastructure |
| **S** | Examples — migrate off in-memory `ProcessStore.layer` | Most examples use memory |
| **T** | Examples — legacy file storage | `process-store-events-file-layer.ts` |
| **U** | Tests — conformance & coverage gaps | Per-module test debt |
| **V** | Documentation alignment | `STORAGE.md`, guides, inventory drift |
| **W** | Compose-time wiring | `ProcessGroup.localEnvLayer`, `groupChild`, `ControlService` types |
| **X** | `ControlProtocol` / `ControlTransportHttp` / `cli` | Confirm no storage (document) |
| **Y** | Cross-module invariant audit | Leaking requirements, duplicate layers, import leaks |
| **Z** | Release checklist | Changeset, export surface, final smoke |

---

## Part A — Agent charter (required)

You are refactoring persistence integration in `@nikscripts/effect-pm`. Previous agents left **inconsistent, legacy, and under-documented** storage wiring. Your job is to bring assigned modules up to the same bar as **`QueueResource` → `ProcessStoreQueueResource`** and **`Logs` → `ProcessStoreGroupLog`**.

### Architecture (non-negotiable)

| Piece | Role |
|-------|------|
| **`RuntimeStorage`** | Normalized `RuntimeRecord` port — the only low-level row storage |
| **Facet services** (`internal/store/*`) | `ProcessStoreGroupLog`, `ProcessStoreQueueResource`, `ProcessStoreRuntime`, … — each has `Context.Service` + `layerRuntimeStorage` |
| **`ProcessStore` (target)** | **Layer combiner only** — `Layer.mergeAll` of facet layers; optional `layer` = provide in-memory `RuntimeStorage` |
| **`@nikscripts/effect-pm/Logs`** | Capture + relay only — never a storage facet on the combiner |
| **`layerProcessStore`** (`storage/sqlite`) | `Layer.provide(ProcessStore.layerRuntimeStorage, sqlite RuntimeStorage)` |

**One stack:** `RuntimeStorage` + facet layers. No monolithic `append` service.

### Domain module rules

1. **Optional storage:** `Effect.serviceOption(FacetTag)` — write when present, silent no-op when absent.
2. **No storage `Layer`s on domain modules** — compose at app / `ProcessGroup.localEnvLayer` / group child only.
3. **No raw `append` from feature code** — use the facet for that domain (or propose one).
4. **No `yield* ProcessStore`** in domain modules — that tag is going away.
5. **Slim imports:** e.g. `QueueResource` → `internal/store/queueResource` only.
6. **Public vs internal:** See [public-vs-internal rule](../.cursor/rules/public-vs-internal.mdc); facets stay internal unless apps truly need the tag.

### Effect & TypeScript standards

- **Effect v4 idioms:** `Effect.gen`, `Layer.merge` / `provide` / `provideMerge` at entry points only; inspect `repos/effect/` before guessing APIs.
- **Context services:** `Context.Service` with **deterministic keys** matching file path (see existing `internal/store/*` keys).
- **No type casts** (`as`, `as any`, `as never`) — refactor types until the compiler is satisfied.
- **No `@effect-diagnostics strictEffectProvide:off`** unless the file is a **documented entry point** (bin, control server root). Prefer fixing layer composition.
- **`captureLoggerLayer`:** must retain `satisfies Layer.Layer<never, never, ProcessManagerLogRelay>` (or equivalent) — do not weaken to `Layer<never>` without reason.
- **Requirements:** `Effect` error and context types must be accurate — no `unknown` leaks in public APIs.
- **Imports:** extensionless relative paths only (`./ProcessStore`, not `./ProcessStore.js`).

### Documentation standards

- **`@module`** on every public file under `src/*.ts`.
- **`@public` / `@internal`** on exported symbols.
- **TSDoc on every public export:** purpose, `@param`, `@returns`, `@example` when non-obvious, `@see` cross-links to facets and compose points.
- **Comments:** explain *why* (business logic, scope lifetimes, failure isolation) — not what the code literally does.
- **No stale references** to removed subpaths (`ProcessStoreGroupLog`, `ProcessStoreQueueResource` as package exports).

### Testing standards

- Add **`test/*.test.ts`** beside existing suites; use `@effect/vitest` patterns already in repo.
- Test **with facet layer provided** and **without** (no-op path).
- Prefer **`layerProcessStore`** or `ProcessStore.layer` explicitly in tests — document which.
- Do not add tests that only assert mocks/trivialities.

### Deliverable (parts B–Y)

Work happens in the repo on the current branch. The maintainer reviews your **chat report** — not a PR.

**Step 1 — Refactor (do this first):**

- Bring assigned code up to Part A standards before designing new storage APIs.
- Keep changes limited to your part; leave other letters for their agents.

**Step 2 — Report (stop here unless told to continue):**

Post a structured reply with two sections:

#### 1. Changes made

- Summary of refactors and fixes (quality, typing, Effect layers, tests, TSDoc).
- File list (paths only — no need for a full diff).
- Verification results (`typecheck` / `test` / `lint` / `build` pass or fail).
- Anything intentionally **not** done (out of scope, blocked, needs another part).

#### 2. Proposed storage API

Design for the **next** step (facet implementation). Include:

- Context tag name and deterministic key
- `Api` interface (methods, input types, error types)
- Event types (`ProcessStoreEvent` additions) if any
- Layer constructors (`layerRuntimeStorage`, etc.)
- How the domain module calls the facet (`serviceOption` pattern)
- Migration from current code (before/after snippet)
- Confirmation that **nothing** new lands on `ProcessStoreInterface` (interface is slated for removal in Part P)

**Step 3 — Build (only after maintainer approval):**

- Implement facet under `src/internal/store/<name>.ts` with `Context.Service` + `layerRuntimeStorage`
- Migrate domain module to `Effect.serviceOption(FacetTag)`
- Tests + doc updates in scope of your part
- **Do not** add methods to `ProcessStore.ts` — Part P wires the combiner after facets exist
- Report again with “Changes made” (Step 2 format); still **no PR** unless asked

**Do not** create commits unless the maintainer explicitly requests them.

---

## Part B — `RuntimeState` / `RuntimeObserver` + Runtime facet

**Prompt:** Part B owns **`ProcessStoreRuntime`** in `src/internal/store/runtime.ts` and **`RuntimeState.ts`**. A previous agent added **`ProcessStore.runtime.*`** and refactored through **`ProcessStore.append`** — that is the **wrong direction** (extends the monolith). **Do not touch `src/ProcessStore.ts`.**

**Files you may edit:** `src/RuntimeState.ts`, `src/internal/store/runtime.ts`, `src/internal/store/spine.ts` (helpers only), `test/run-resource.test.ts`, `examples/forms/process-store/process-store-events-sqlite-layer.ts`.

**Files you must not edit:** `src/ProcessStore.ts`, `src/internal/store/composite.ts` (Part P).

**Current problems:**

- `RuntimeObserver.layerFromProcessStore` depends on the legacy `ProcessStore` tag.
- `makeProcessStoreRuntime` exists as a plain factory, not a `Context.Service` with `layerRuntimeStorage`.
- `ProcessStore.runtime` namespace on the combiner module (legacy — do not extend; Part P removes it).

**Refactor goals (Phase 1, in-scope files only):**

- Clean up `RuntimeObserver` typing; listener isolation unchanged.
- Prepare `runtime.ts` for a proper facet tag (deterministic key under `internal/store/runtime`).
- Observer persistence should target **`ProcessStoreRuntime`** via `serviceOption`, not `ProcessStore.append`.

**Proposed API must define:**

- `ProcessStoreRuntime` `Context.Service` + `ProcessStoreRuntimeApi` (`recordFact`, `recordStateChange`, `facts`, `stateHistory`, `latestState`, batches)
- `ProcessStoreRuntime.layerRuntimeStorage` (requires `RuntimeStorage`)
- `RuntimeObserver.layerFromRuntimeStorage` or `layer` that requires **`ProcessStoreRuntime`** (name TBD)
- Deprecation path for `layerFromProcessStore` and removal of `ProcessStore.runtime` queries (Part P)

**Anti-patterns (instant fail):**

- Adding `ProcessStore.runtime`, `ProcessStore.runResource`, or new methods on `ProcessStoreInterface`
- Editing `ProcessStore.ts` “to wire things up temporarily”
- Calling `store.append` from `RuntimeState.ts` after refactor (use facet API only)

---

## Part C — `Process.ts` + ProcessExecution facet

**Prompt:** `Process.ts` still **`append`s `process.execution.completed`** and reads via **`getProcessExecutions`**. That is legacy spine usage. **`QueueResource` already shows the correct pattern.** Replace it properly.

**Files:** `src/Process.ts`, `src/ProcessStoreEvent.ts`, `src/internal/store/spine.ts`, `test/process.test.ts`. **Not** `src/ProcessStore.ts`.

**Current problems:**

- Raw append from supervisor path.
- `ProcessSupervisorRequirements` includes `ProcessStore` broadly instead of a slim facet tag.
- Execution analytics not namespaced like `QueueResource` entry lifecycle.

**Refactor goals:**

- Extract recording behind a facet-shaped boundary (even before facet exists: isolate in one internal helper).
- Preserve silent no-op when store absent.
- Keep `Process.effect` requirement typing accurate after migration.

**Proposed API must define:** `ProcessStoreProcessExecution` facet — record completion/failure/interrupted, query by process id, schedule key, time range; event type reuse vs new types.

---

## Part D — `ProcessGroup.ts` + ProcessLifecycle facet

**Prompt:** `ProcessGroup` **`append`s lifecycle events** and **`localEnvLayer` defaults to `ProcessStore.layer`** (in-memory). Apps that expect durable lifecycle history get silent data loss on restart. Fix the architecture, not just the comment.

**Files:** `src/ProcessGroup.ts`, `test/process-group*.test.ts`, examples using `ProcessStore.layer`.

**Current problems:**

- Raw `recordLifecycle` → `store.append`.
- Status/`ls` derivation mixes fiber liveness + store without a lifecycle facet query API.
- Default store is in-memory without loud documentation in TSDoc on `localEnvLayer`.

**Refactor goals:**

- Isolate lifecycle recording; prepare for facet.
- Document compose-time store requirements in `localEnvLayer` TSDoc with sqlite example.
- Do not add storage layers inside `ProcessGroup.make`.

**Proposed API must define:** `ProcessStoreProcessLifecycle` facet — record Started/Stopped/etc., query lifecycle timeline per process/group, projection helpers for CLI status.

---

## Part E — `RunResource.ts`

**Prompt:** `RunResource` publishes to **`RuntimeObserver`** but never ensures persistence. Apps must remember `RuntimeObserver.layerFromProcessStore`, which still uses legacy append. **Make RunResource’s relationship to storage explicit and correct.**

**Files:** `src/RunResource.ts`, `test/run-resource.test.ts`, `examples/forms/resource/run-resource-runtime-observer.ts`.

**Current problems:**

- Facts/state changes only persist when observer + legacy store layer composed manually.
- No HTTP/run-gate-specific fact types (shared with generic runtime facts).
- TSDoc does not tell operators how to enable durable run history.

**Refactor goals:**

- Keep observation optional; improve types for `RunResourceState` / facts.
- Document compose recipe (observer + store + facet after Part B).
- Do not embed `Layer` in `RunResource.make`.

**Proposed API must define:** whether RunResource stays on **`ProcessStoreRuntime`** only or needs **`RunResource`-prefixed fact types**; method names; correlation via `RuntimeRef`. Do **not** add `ProcessStore.runResource` to the combiner module.

---

## Part F — `HttpClientRunGate.ts`

**Prompt:** This module is a thin **`HttpClient.transform`** wrapper. It has **zero storage integration**. Either document why it intentionally has none, or define how gated HTTP requests emit facts **through the same path as RunResource**.

**Files:** `src/HttpClientRunGate.ts`, `examples/forms/resource/http-client-run-gate.ts`.

**Refactor goals:**

- No storage layer on module.
- If facts are desired, they must flow through RunResource runner / observer — propose hooks, not append.

**Proposed API:** “No facet” **or** “delegate to RunResource runner instrumentation” — pick one with rationale.

---

## Part G — `HttpApiResource.ts`

**Prompt:** **`HttpApiResource` has no ProcessStore support** while the inventory says it should mirror RunResource (in-flight / completed / failed HTTP runs). Previous agents ignored it. **Design it properly.**

**Files:** `src/HttpApiResource.ts`, `examples/forms/resource/http-api-resource-*.ts`, `examples/scenarios/nwslsoccer/http-api-resource.ts`.

**Current problems:**

- Concurrency gating only; no analytics.
- Examples never compose store/observer.

**Refactor goals:**

- Optional telemetry via observer/facet — no mandatory store in `make`.
- Respect `limits` / semaphore semantics in fact payloads.

**Proposed API must define:** fact types for request started/completed/failed, linkage to api name + endpoint, optional state snapshots; integration point in `make` / `layerEffect`.

---

## Part H — `Resource.ts`

**Prompt:** Audit **`Resource.ts`**. If it is a generic helper with no runtime analytics, **document N/A** and close the part. If it should propagate storage hooks to subclasses, say how — don’t invent scope.

**Files:** `src/Resource.ts`.

**Deliverable:** Either “no storage integration required” with TSDoc note, or a minimal proposal for resource-kind facts on **`ProcessStoreRuntime`**.

---

## Part I — `Polling.ts`

**Prompt:** **`Polling` has no telemetry.** For long-running processes, operators cannot see tick cadence, skips, or armed/disarmed transitions in the store. **Add optional telemetry the right way.**

**Files:** `src/Polling.ts`, `src/Process.ts` (supervisor uses polling), tests, polling examples.

**Refactor goals:**

- `serviceOption` only; no Layer on `Polling`.
- Events tied to process id / polling preset name when available from context.

**Proposed API must define:** event types (`polling.tick`?, `polling.skipped`?), facet vs reusing Runtime/ProcessExecution, cardinality concerns (high volume).

---

## Part J — `ProcessSchedule.ts`

**Prompt:** **`ProcessSchedule` has no store integration.** Schedule arm/disarm and window boundaries are invisible in analytics. **Fix that without writing on every schedule poll.**

**Files:** `src/ProcessSchedule.ts`, `src/Process.ts`, schedule examples.

**Proposed API must define:** lifecycle of schedule entries (armed, disarmed, window open/close), dedupe strategy, query API for “what schedule fired for process X”.

---

## Part K — `QueueResource.ts` (verification)

**Prompt:** **`QueueResource` is the reference implementation.** Your job is to **verify** the previous agent didn’t cut corners, then **propose extensions only if justified**.

**Files:** `src/QueueResource.ts`, `src/internal/store/queueResource.ts`, `test/queue-resource.test.ts`, `test/process-store.test.ts`.

**Checklist:**

- All entry lifecycle paths emit facet events when `ProcessStoreQueueResource` present.
- No raw `ProcessStore.append` in QueueResource.
- Errors logged, not thrown, on store write failure.
- TSDoc mentions optional store compose.

**Proposed API:** Either “no change” or explicit extension list (new query methods, lifecycle tags) with migration notes.

---

## Part L — `Logs` + PM log pipeline (verification)

**Prompt:** The log pipeline (**capture → relay → GroupLog → sqlite**) was assembled by multiple agents. **Audit it like a competitor** — find duplication, weak types, missing TSDoc, strictEffectProvide cheats.

**Files:** `src/Logs.ts`, `src/internal/manager/logCapture.ts`, `logPersistRelay.ts`, `logHistory.ts`, `logQuery.ts`, `test/logs.test.ts`, `test/process-manager-log-pipeline.test.ts`.

**Checklist:**

- No `ProcessStore` import in relay for anything except GroupLog facet.
- `relayWithCaptureLoggerLayer` composition is typed correctly.
- `captureLoggerLayer satisfies Layer<never, never, ProcessManagerLogRelay>`.
- PM opens per-group sqlite only in operator paths — document in TSDoc.

**Proposed API:** Confirm GroupLog facet is sufficient or propose extensions (retention, indexes, batch limits).

---

## Part M — `ProcessManager.ts` operator reads

**Prompt:** **`pm logs` / `pm watch`** use GroupLog + sqlite paths. Previous agents may have left rough error messages, strictEffectProvide off in `logHistory`, or missing filters. **Polish and propose operator query API extensions.**

**Files:** `src/ProcessManager.ts`, `internal/manager/logHistory.ts`, `logQuery.ts`, `groupLogWatch*.ts`, `test/process-manager*.test.ts`.

**Proposed API:** Richer `ProcessManagerLogQuery` filters, cross-group catalog queries, pagination cursors — without exposing internal modules from `index.ts`.

---

## Part N — Legacy file storage

**Prompt:** **`ProcessStore.file` / `storage/file`** is a **second persistence model** (NDJSON). It is deprecated but still reachable. Either **delete**, or **reimplement as RuntimeStorage adapter** — no half measures.

**Files:** `src/ProcessStore.ts`, `src/internal/store/composite.ts`, `src/internal/store/spine.ts`, `src/storage/file.ts`, `examples/forms/process-store/process-store-events-file-layer.ts`, `test/process-store.test.ts` (legacy describe block).

**Proposed API:** Removal plan **or** `RuntimeStorage` file adapter shape; migration guide from NDJSON to sqlite.

---

## Part O — Prisma adapter rebuild

**Prompt:** **`PrismaProcessStore` throws `PrismaProcessStoreUnavailableError`** — the old adapter was removed and never rebuilt on `RuntimeStorage`. **Design the real adapter**, not another placeholder.

**Files:** `src/prisma/*`, `src/storage/prisma.ts`, `test/prisma-process-store.test.ts`, `examples/forms/process-store/process-store-prisma-structural-client.ts`.

**Proposed API:** `RuntimeStorage` implementation over Prisma `RuntimeRecord` table; `layerProcessStore` equivalent; schema migration story; no legacy `EffectPmEvent` envelope table unless maintainer insists.

---

## Part P — Demolish legacy `ProcessStore` → layer combiner only

**Prompt:** **`ProcessStore.ts` today is a monolith** (`Context.Service`, `ProcessStoreInterface`, `append`, `getProcessExecutions`, nested `GroupLog`/`QueueResource`, `ProcessStore.runtime`). **Your job is to delete that model** and leave **`ProcessStore` as namespace + layer combiner only**, after facets from Parts B–D exist and are approved.

**Prerequisite:** Facet tags exist for runtime, process execution, lifecycle (at minimum). Do not start Part P until maintainer confirms.

**Files:** `src/ProcessStore.ts`, `src/internal/store/composite.ts`, `src/index.ts`, `package.json` exports, tests that `yield* ProcessStore`.

**Target end state:**

```ts
export namespace ProcessStore {
  export const layerRuntimeStorage = Layer.mergeAll(
    ProcessStoreGroupLog.layerRuntimeStorage,
    ProcessStoreQueueResource.layerRuntimeStorage,
    ProcessStoreRuntime.layerRuntimeStorage,
    // …other facet layerRuntimeStorage entries
  );
  export const layer = Layer.provide(layerRuntimeStorage, RuntimeStorage.layer);
}
// No Context.Service class named ProcessStore
// No ProcessStoreInterface
// No append / events / getProcessExecutions on a monolith
```

**Also remove:** `memory`, `file`, `fileLayer` from public surface (or move to `storage/file` quarantine only). **`ProcessStoreEvent.ts`** stays — event types are shared; the monolith interface goes.

**Proposed API (Phase 1 report):** Migration checklist: every `yield* ProcessStore` callsite → which facet; combiner layer type (`Layer` output union of facet tags); breaking changes for `@nikscripts/effect-pm/ProcessStore` subpath.

---

## Part Q — `storage/sqlite`

**Prompt:** **`layerProcessStore` uses `Layer.orDie`** — failures become defects. **Surface typed errors** where apps can handle them (inventory item M7).

**Files:** `src/storage/sqlite/index.ts`, `service.ts`, `codec.ts`, `ddl.ts`, tests.

**Proposed API:** Error channel on `layerProcessStore` / `SQLiteRuntimeStorage.layer`; which ops map to `PlatformError` vs `SqlError`.

---

## Part R — `internal/store` infrastructure

**Prompt:** Spine, codec, and composite were split during a hurried reorg. **Review for duplication, wrong imports, and missing `@internal` docs.**

**Files:** `src/internal/store/spine.ts`, `codec.ts`, `composite.ts`, `groupLog.ts`, `queueResource.ts`.

**Proposed API:** Shared helpers for new facets (event encoding, context tags, `makeProcessStoreSpine` usage) — a short “facet author’s guide” embedded in your proposal.

---

## Part S — Examples: in-memory store

**Prompt:** Most examples use **`ProcessStore.layer`** (in-memory). That teaches data loss on restart. **Update teaching examples** to show sqlite **where durability matters**, keep memory only in examples explicitly about “memory store”.

**Files:** `examples/forms/schedule/*`, `examples/forms/polling/*`, `examples/scenarios/*`, `examples/forms/process-group/*`.

**Deliverable:** List of files to change + pattern (`layerProcessStore` with temp file in harness); implement after maintainer approves scope.

---

## Part T — Examples: legacy file

**Prompt:** **`process-store-events-file-layer.ts`** uses deprecated `storage/file`. Quarantine or rewrite to sqlite; module doc must scream **legacy**.

**Files:** `examples/forms/process-store/process-store-events-file-layer.ts`, `examples/README.md`.

---

## Part U — Tests

**Prompt:** Add **conformance tests** so new facets behave like QueueResource/GroupLog: optional layer, write failure isolation, query round-trip.

**Files:** `test/runtime-storage.conformance.ts` (extend or mirror), per-facet new files.

**Proposed API:** Test matrix template other agents must fill for their facet.

---

## Part V — Documentation

**Prompt:** **`STORAGE.md` still references removed subpaths.** Guides may contradict post-reorg layout. **Fix all storage docs** to match code.

**Files:** `docs/STORAGE.md`, `docs/STORAGE-INTEGRATION-INVENTORY.md`, `docs/guides/*.md`, `docs/PROCESS-API.md` storage sections.

**Deliverable:** Doc diff checklist; no code unless doc examples are executable.

---

## Part W — Compose-time wiring

**Prompt:** Document **who provides the store** — `ProcessGroup.localEnvLayer`, `groupChild`, playground apps. Previous agents duplicated relay layers and confused sqlite vs memory.

**Files:** `src/ProcessGroup.ts`, `src/internal/manager/groupChild.ts`, `src/internal/manager/groupRuntime.ts`, `docs/guides/process-group.md`.

**Proposed API:** Recommended layer recipes (memory dev, sqlite local, child process) as copy-paste blocks in guide TSDoc.

---

## Part X — Control plane (no storage)

**Prompt:** Confirm **`ControlService`, `ControlProtocol`, `ControlTransportHttp`, `cli.ts`** never persist. **Document** that persistence is child/group responsibility. Fix any misleading types.

**Files:** listed above + `test/control-service-contract.test.ts`.

**Deliverable:** Short architecture note; type-only `ProcessStore` in requirements explained.

---

## Part Y — Cross-module audit

**Prompt:** Hunt **import leaks** (public apps importing `internal/store`), **duplicate Layer merges**, **raw append** outside spine/facets, **index.ts export sprawl**, **deterministic key violations**.

**Deliverable:** Table of violations + which part (B–X) owns each fix.

---

## Part Z — Release checklist

**Prompt:** When parts B–Y are done (or scoped release is cut):

- [ ] **Changeset** for `@nikscripts/effect-pm` (maintainer reminder — do not skip).
- [ ] `pnpm typecheck` / `test` / `lint` / `build` green.
- [ ] No new package subpaths for internal facets without explicit approval.
- [ ] `index.ts` exports match public-vs-internal rule.
- [ ] Breaking changes documented in changeset body.
- [ ] Examples run (`examples/README.md` commands).
- [ ] Manual smoke: group child logs → sqlite → `pm logs` (if PM parts touched).

---

## Appendix — Full module audit (snapshot)

### No ProcessStore support yet

| Module | Notes |
|--------|--------|
| `HttpApiResource` | Gated HTTP client only |
| `HttpClientRunGate` | Transport wrapper |
| `Resource` | Generic helper — likely N/A |
| `Polling` | No telemetry |
| `ProcessSchedule` | No telemetry |

### Correctly no storage

| Module | Role |
|--------|------|
| `ControlProtocol`, `ControlTransportHttp` | Wire protocol |
| `ControlService` | Types only; no writes |
| `cli.ts` | HTTP client |
| `disarmedIdleSleep` | Pure policy |
| `Query`, `RuntimeStorage` | Port / DSL |
| `Transport`, `LogContext`, `LogEntry` | PM types/wiring |
| `internal/json`, `utcDate`, `processLayerBrand` | Utilities |

### Legacy ProcessStore usage (migrate to facets — then remove monolith in Part P)

| Module | Pattern |
|--------|---------|
| `Process` | `serviceOption(ProcessStore)` → `append` / `getProcessExecutions` |
| `ProcessGroup` | `store.append` lifecycle; `localEnvLayer` defaults to `ProcessStore.layer` |
| `RuntimeObserver.layerFromProcessStore` | reads monolith tag → append |
| **`ProcessStore.ts` itself** | `ProcessStore.runtime.*` re-fetches monolith — **wrong**; queries belong on **`ProcessStoreRuntime`** facet |

### Modern integration (reference)

| Module | Pattern |
|--------|---------|
| `QueueResource` | `ProcessStoreQueueResource` via `serviceOption` |
| `Logs` / `logPersistRelay` | `ProcessStoreGroupLog.recordBatch` |
| `ProcessManager` log commands | `GroupLog.load` / `query` + per-group sqlite |
| `groupChild` | `layerProcessStore` + `relayWithCaptureLoggerLayer` |
| `storage/sqlite` | `layerProcessStore` |

### Deprecated storage surfaces

| Surface | Location |
|---------|----------|
| `ProcessStore.file`, `fileLayer`, `memory` | `ProcessStore.ts` |
| NDJSON file store | `internal/store/composite`, `spine`, `storage/file` |
| Prisma placeholder | `prisma/*`, `storage/prisma` |

### Event types in spine today

| Event type | Writer | Reader |
|------------|--------|--------|
| `process.execution.completed` | `Process.ts` (raw append) | `getProcessExecutions` |
| `process.lifecycle.changed` | `ProcessGroup.ts` (raw append) | `events` / status |
| `queue.*` | `QueueResource` → QueueResource facet | facet queries |
| `runtime.fact.recorded` | `RuntimeObserver.layerFromProcessStore` | `ProcessStore.runtime.facts` |
| `runtime.state.changed` | same | `ProcessStore.runtime.stateHistory` |
| `group.log.entry` | GroupLog facet / relay | `GroupLog.load` / `query` |

---

*Linked from [`STORAGE-INTEGRATION-INVENTORY.md`](./STORAGE-INTEGRATION-INVENTORY.md) and [`AGENTS.md`](./AGENTS.md).*
