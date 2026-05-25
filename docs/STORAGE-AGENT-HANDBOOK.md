# Storage integration agent handbook

**Purpose.** Dispatch a single per-module storage-service assignment to an agent. Nothing else lives here.

- **How storage works** → [`STORAGE.md`](./STORAGE.md)
- **How to build a facet** → [`STORAGE-FACET-AUTHORING-GUIDE.md`](./STORAGE-FACET-AUTHORING-GUIDE.md)
- **Package-level invariants** → [`AGENTS.md`](./AGENTS.md), [`.cursor/rules/public-vs-internal.mdc`](../.cursor/rules/public-vs-internal.mdc)

Do **not** restate any of those here. If an assignment seems to need new architecture, **fix the linked doc** instead of growing the assignment card.

---

## How to assign

1. Pick **one** numbered assignment below. Do not bundle.
2. Copy the **Prompt** block verbatim into the agent context.
3. The agent works on the current branch — no PR, no commit unless you ask.
4. The agent reports back with **Changes made** + **Verification** + anything intentionally not done.

### Prompt template (used by every assignment)

```
Do "<assignment title>" from docs/STORAGE-AGENT-HANDBOOK.md.

Read first:
- docs/STORAGE-AGENT-HANDBOOK.md (your assignment card)
- docs/STORAGE-FACET-AUTHORING-GUIDE.md (mechanics)
- docs/STORAGE.md (current public contract)
- docs/AGENTS.md and .cursor/rules/public-vs-internal.mdc (invariants)

Stay inside the assignment's "Files in scope". Treat "Files off limits" as
build errors if you touch them.

Follow the per-domain rule: no shared generic envelope in any new public
API. No backward-compatibility shims.

Verify with:
  pnpm typecheck && pnpm test && pnpm lint && pnpm build
  for i in 1 2 3 4 5 6 7 8 9 10; do echo "Run $i"; pnpm test 2>&1 | tail -3 | grep Tests; done

Report:
1. Changes made — files touched (paths), summary of refactor, anything
   intentionally deferred or out of scope.
2. Verification — typecheck / test / lint / build results, 10× loop result.
3. Open questions for the maintainer (if any).

No PR. No commit unless I explicitly ask.
```

---

## Status board

Each row: which source module needs storage setup work, what facet (if any) it has today, and which open assignment owns it.

| Source module | Public facet | Status | Open assignment |
|---|---|---|---|
| `src/RunResource.ts` | `ProcessStoreRunResource` (builder) | Done — reference impl | — |
| `src/Process.ts` (executions) | `ProcessStoreProcessExecution` (builder) | Done | — |
| `src/Process.ts` (lifecycle) | `ProcessStoreProcessLifecycle` (builder) | Done | — |
| `src/ProcessGroup.ts` (typed member lifecycle) | `ProcessStoreProcessGroup` (builder) | Done | — |
| `src/Logs.ts` + PM log relay | `ProcessStoreLog` (hand-rolled `Context.Service`) | Hand-rolled — builder-or-exception decision pending | **Assignment 2** |
| `src/QueueResource.ts` | `ProcessStoreQueueResource` (hand-rolled, on internal `factEnvelope`) | Hand-rolled — per-domain wire types pending | **Assignment 1** |
| `src/Polling.ts` | none | Design proposal needed | **Assignment 3** |
| `src/ProcessSchedule.ts` | none | Design proposal needed | **Assignment 3** |
| `src/HttpApiResource.ts` | none | Design proposal needed | **Assignment 3** |
| `src/HttpClientRunGate.ts` | — (delegates to `RunResource`) | No storage — confirmed | — |
| `src/Resource.ts` | — | No storage — confirmed | — |
| `src/ControlService.ts`, `ControlProtocol.ts`, `cli.ts` | — | No storage — confirmed (control plane) | — |

---

## Open assignments

### Assignment 1 — Migrate `ProcessStoreQueueResource` off the internal `factEnvelope`

**Goal.** Move `ProcessStoreQueueResource` from the internal generic `runtime.fact.recorded` / `runtime.state.changed` envelope to its own concrete `queue.*` wire event types, authored on `ProcessStoreBuilder.Service`. After this lands, the only remaining `FactEnvelope*` consumer is internal plumbing with no public surface.

**Why.** The per-domain rule (`STORAGE.md` "Do not", `STORAGE-FACET-AUTHORING-GUIDE.md` non-negotiables) says every public facet owns concrete typed shapes. `ProcessStoreQueueResource` is the last facet that still pretends `queue.entry.completed` / `queue.lifecycle.*` ride a generic envelope. The hand-rolled `Context.Service` predates the builder; rewriting it on the builder both removes the envelope debt and deletes the duplicate `Effect.serviceOption` / optional-emit boilerplate.

**Files in scope.**
- `src/store/queueResource.ts` (full rewrite onto `ProcessStoreBuilder.Service`)
- `src/ProcessStoreEvent.ts` (add `QueueEntryRecordedEvent`, `QueueLifecycleRecordedEvent`, etc. as `@public` with `type: "queue.entry.recorded"` / `"queue.lifecycle.recorded"`; the old `RuntimeFactRecordedEvent` alias used by this facet can go internal-only if no other facet uses it)
- `src/internal/store/codec.ts` (encode / decode for the new wire types; keep envelope decode behind `isLegacyEventRecordType` so existing SQLite rows still load)
- `src/internal/store/spine.ts` (new per-domain query helpers; keep envelope helpers internal)
- `src/QueueResource.ts` (publish sites — `recordEntryEvent` etc. → per-type static emitters)
- `test/queue-resource.test.ts`, `test/process-store.test.ts` (the queue sections)
- `test/process-store-queue-resource-facet.test.ts` (**new** conformance suite, mirror `test/process-store-run-resource-facet.test.ts`)

**Files OFF LIMITS.**
- Every other facet in `src/store/*.ts`
- `src/internal/store/factEnvelope.ts` (delete only if you have removed every other consumer; otherwise leave it)

**Acceptance.**
- [ ] `ProcessStoreQueueResource` is declared with `ProcessStoreBuilder.Service` and exposes the per-type static optional emitters that today exist as `entryEnqueued` / `entryCompleted` / `lifecycleChanged` / `dedupeKey*` etc.
- [ ] Wire event `type` strings are `queue.*` (no `runtime.*` left in the encoder for this facet).
- [ ] `QueueResource.ts` publishes through the new static emitters; no `Effect.serviceOption(ProcessStoreQueueResource)` boilerplate remains in the feature module.
- [ ] New conformance suite covers no-op-vs-persist, failure isolation, projections, phantom types.
- [ ] SQLite rows persisted before this assignment still decode (legacy `runtime.fact.recorded` rows with `payload.queue.*` shape).
- [ ] `.changeset/` entry documents the wire-event rename as a breaking change for any direct `ProcessStore.events(...)` consumers.
- [ ] Verification block in the prompt template passes; 10× test loop is deterministic.

**How to do it.** Walk `STORAGE-FACET-AUTHORING-GUIDE.md` start to finish. Use `src/store/runResource.ts` + `test/process-store-run-resource-facet.test.ts` as the worked example. Watch the guide's "When the builder is not enough" section if you find you need shared per-layer state (you probably don't — `QueueResource.entryEnqueued` and friends are pure records).

---

### Assignment 2 — Decide `ProcessStoreLog`: builder or documented exception

**Goal.** Either migrate `ProcessStoreLog` to `ProcessStoreBuilder.Service`, or document in code **and** in `STORAGE-FACET-AUTHORING-GUIDE.md` why it cannot — and what would need to change in the builder to lift the restriction.

**Why.** `ProcessStoreLog` is hand-rolled today because the log relay path needs **shared per-layer state** (the relay queue, deduper, and watch subscribers live across record + read sections). The authoring guide already calls this out in "When the builder is not enough". The maintainer wants a concrete answer: extend the builder to support a shared `make` block, or keep `Log` as the explicit exception.

**Deliverable shape.** This assignment **stops after a proposal** — do not migrate without approval.

**Files to read (do not edit yet).**
- `src/store/log.ts`
- `src/internal/manager/logPersistRelay.ts`
- `src/internal/manager/logCapture.ts`
- `src/internal/store/service.ts` (the builder internals — `defineProcessStoreService`)
- `STORAGE-FACET-AUTHORING-GUIDE.md` — "When the builder is not enough"

**Acceptance (Phase 1 — proposal only).**
- [ ] Markdown proposal under `docs/storage-proposals/log-builder.md` (new file is fine here) with two options:
  - **A. Extend the builder** to accept an optional `make` block returning a context value passed to `record` and `read` (sketch the TS signature, list the conformance-test changes, list the breakages for current builder facets).
  - **B. Keep `Log` hand-rolled** and add a small `wrapHandRolledEmitter` helper modelled on the builder's `wrapEmitForFacet` so the per-type static-emitter pattern is at least uniform across builder + hand-rolled facets.
- [ ] Recommendation with rationale.
- [ ] No source-code change in this phase.

**Phase 2 (only after maintainer picks A or B).** Implement, mirror the run-resource conformance suite, update `STORAGE-FACET-AUTHORING-GUIDE.md`'s "When the builder is not enough" section, and ship a `.changeset/`.

---

### Assignment 3 — Design proposal: telemetry for `Polling`, `ProcessSchedule`, `HttpApiResource`

**Goal.** Decide whether each of these three modules deserves its own per-domain facet, joins an existing one, or stays storage-free. **Proposal only — no implementation.**

**Why this is one assignment.** All three are gates / drivers that currently have zero analytics. The same design questions apply to each (cardinality, dedupe, correlation), so do them together to avoid three different answers.

**Deliverable.** One markdown file per module under `docs/storage-proposals/` (create the directory if needed):

- `docs/storage-proposals/polling-telemetry.md`
- `docs/storage-proposals/process-schedule-telemetry.md`
- `docs/storage-proposals/http-api-resource-telemetry.md`

Each file answers, in order:

1. **Should it have a facet?** (yes / no / "delegate to X")
2. **If yes:** facet name, wire event types (concrete, per-domain), public types (`*Ref`, `*Fact`, `*State`, `*StateChange` if needed), projections (`facts`, `latestState`, `runs`, …).
3. **Cardinality / volume estimate** — for `Polling` especially, naive "record every tick" is a non-starter.
4. **Correlation strategy** — how does an event link back to the owning process / run / queue entry?
5. **Compose-time wiring** — which layer(s) provide the facet?
6. **Open questions** for the maintainer.

**Files to read (do not edit).**
- `src/Polling.ts`, `src/ProcessSchedule.ts`, `src/HttpApiResource.ts`
- `src/store/runResource.ts` + `src/store/processExecution.ts` as templates for proposal vocabulary
- `STORAGE-FACET-AUTHORING-GUIDE.md`

**Acceptance.**
- [ ] Three proposal files exist, each ≤ 300 lines, each with the six sections above.
- [ ] No source code change.
- [ ] Each proposal links back to the relevant authoring-guide section it depends on.

**Phase 2 (only after the maintainer approves any one proposal).** That proposal becomes its own assignment in this handbook, with the prompt-template flow.

---

*Linked from [`AGENTS.md`](./AGENTS.md), [`STORAGE.md`](./STORAGE.md), [`STORAGE-FACET-AUTHORING-GUIDE.md`](./STORAGE-FACET-AUTHORING-GUIDE.md), [`STORAGE-INTEGRATION-INVENTORY.md`](./STORAGE-INTEGRATION-INVENTORY.md).*
