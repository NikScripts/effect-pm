# Recipe: Telemetry split — bake session handoff

**Goal:** Lock the full telemetry / archive / projection / state model before more
implementation. Fix vocabulary drift and replace hub-branch interim APIs (`defineEvent`,
`RunResourceHubTelemetry`) with the agreed design.

**Non-goals:** Implement slices in this session; transport work; dashboard UI.

**Owner prompt to start bake:** paste [telemetry-split-bake-prompt.md](../handoffs/telemetry-split-bake-prompt.md).

**Canonical vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md).

**Architecture (locked Jun 2026):** [architecture-split-and-transports.md](./architecture-split-and-transports.md).

**Golden telemetry tree (reference branch):** `origin/cursor/facet-telemetry-158c` —
`ProcessStore.telemetry` DSL in `runResource.ts` (port to `Telemetry.Tag`, not
on `*Store`).

**Current hub branch debt:** `src/store/RunResourceTelemetry.ts` uses `TelemetryHub.defineEvent`;
`RunResource.ts` owns telemetry counters in `Ref`; no `Telemetry.Service`, no registry,
no telemetry state module.

---

## Mise en place (repo facts)


| Area                                                | Shipped       | Wrong / missing                                                        |
| --------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `TelemetryHub` + sinks                              | Yes           | Hub used as event definition surface                                   |
| `ArchiveSink`, `ProjectionSink`, `BroadcastSink`    | Yes           | Legs wired to `defineEvent`, not tree                                  |
| `RunResourceStore` decoupled from telemetry section | Yes           | Hand-rolled codecs/wires                                               |
| `RunResourceProjection`                             | Yes           | —                                                                      |
| `State.Scope` + scopes                              | Partial       | RunResource kernel ignores `RunScope`                                  |
| `**Telemetry.Service`**                             | **No**        | Plan 20 target                                                         |
| `**Telemetry.registry`**                            | **No**        | Recipe step 2                                                          |
| **Telemetry state** (in-memory, telemetry-only)     | **No**        | Owner model — [plan 21](../plans/21-state-vocabulary.md)               |
| Plan 17 tree DSL on RunResource                     | **No** on hub | On `facet-telemetry-158c`                                              |
| Transport 6.4–6.6                                   | Merged to hub | —                                                                      |
| Domain folders under `store/`                       | Removed       | Flat PascalCase — [src-reorganization](../plans/src-reorganization.md) |


---

## Architecture principles (still apply — distinct from locked DX)

1. **Isolation / siloing** — opt-in subpaths, layers, registries; combined layers explicitly named.
2. **Three modules per domain** — telemetry tag, `*Store` (archive), `*Projection` (optional); separate tags.
3. **Emit `R = TelemetryHub`** at kernel sites — never `RuntimeStorage` on emit path.
4. **Telemetry tree DSL** — `Telemetry.Tag` with `namespace` / `group` / `operation` / `event`; **not** `defineEvent`.
5. **Hub = router only** — validate + fan-out; definitions live on `Telemetry.Tag`.
6. **Archive optional** — `ArchiveSink` leg; store facet queries only.
7. **Two in-memory state kinds** — process state (`State.Scope`) vs telemetry state (telemetry path only); see plan 21.
8. **Telemetry state never touches storage** — not projection, not durable ops.
9. **Role folders only** — `store/`, `sink/`, `transport/`; PascalCase files; no domain subfolders; no import shims.
10. **Reference implementation order** — restore RunResource telemetry from `facet-telemetry-158c` → hub bridge → Queue.
11. **Store/RPC separate** — `Procedure.payload().success().failure()` and `Store.Tag` are not telemetry APIs.

---

## Telemetry redesign current locks (supersedes stale steps below)

**Only the `Telemetry.Tag` skeleton DX is locked.** Two **additional** APIs are
still open — do not conflate them:

| API | Lives on | Status | Purpose |
| --- | --- | --- | --- |
| **`Telemetry.Tag`** | Tag class | **Locked** | Skeleton contract only: namespaces, groups, operations, events, scopes, `start` / `exit` declarations |
| **Operations API (calling)** | Operation handles from tag + layer | Open | `(input) => pipe(processEntry(input), Effect.flatMap, gen)` + shortcuts |
| **Telemetry layer** | `Layer` | Open | Everything else telemetry does: state, scope extension, hub bridge, registry, emit materialization, operation wrappers |

**Tag stays light.** Do not put telemetry state, handlers, registry, or emit
plumbing on the tag. The layer owns runtime behavior; the operations API owns
how kernel code **enters** a tracked operation with the right input type.

`Procedure.payload().success().failure()` belongs to **`Store.Tag` / RPC only**.
Telemetry vocabulary: **`namespace`**, **`group`**, **`operation`**, **`event`**.
Wire ids: **`Namespace.Group.Event`**. Operations use **`Telemetry.start`** /
**`Telemetry.exit`** — not Procedure selectors.

---

### Definition surface — `Telemetry.Tag` skeleton (locked)

The tag is a **skeleton** only. It declares shape — not runtime behavior.

**On the tag:**

- `Telemetry.namespace` / `Telemetry.group` / `Telemetry.operation` / `Telemetry.event`
- `Telemetry.operation<Input>(…)` — input type on **operation** (leading candidate; not locked)
- `Telemetry.start(…)` / `Telemetry.exit(…)` declarations — no type param on start
- `State.Scope` reference as first child of each operation
- Wire ids derived from namespace + group + event name

**Not on the tag** (layer or operations API instead):

- Telemetry state fields and reducers
- Operation bodies / handlers
- Hub emit bridge, registry, scope-field merging
- Generated `(input) => Effect` runners (operations API — see below)

- `Telemetry.Service` is optional convenience only; built-in package code should not rely on it.
- A telemetry tag may contain multiple `Telemetry.namespace(...)` blocks.
- `Telemetry.group(...)` replaces lowercase `Telemetry.tag(...)` to avoid collision with `Telemetry.Tag`.
- `Telemetry.group(...)` may not nest. Groups define the event wire path segment.
- Events may not live directly under a namespace; events live under a group or inside an operation nested in a group.
- Event wire ids are always `Namespace.Group.Event`. Operation names never contribute to event wire ids.

```ts
class QueueResourceTelemetry extends Telemetry.Tag<QueueResourceTelemetry>(
  "@nikscripts/effect-pm/store/QueueResource/QueueResourceTelemetry",
)(
  Telemetry.namespace("Queue")(
    Telemetry.group("Entry")(
      Telemetry.operation<QueueEntryInput>("processEntry")(
        QueueEntryScope,
        Telemetry.start("Started", QueueEntryStarted),
        Telemetry.event("Retried", QueueEntryRetried),
        Telemetry.operation("rateLimit")(
          QueueEntryScope,
          Telemetry.event("Exceeded", QueueRateLimitExceeded),
          Telemetry.exit({
            onSuccess: Telemetry.event("Accepted", QueueRateLimitAccepted),
            onFailure: Telemetry.event("Rejected", QueueRateLimitRejected),
          }),
        ),
        Telemetry.exit({
          onSuccess: Telemetry.event("Completed", QueueEntryCompleted),
          onFailure: Telemetry.event("Failed", QueueEntryFailed),
          onInterrupt: Telemetry.event("Released", QueueEntryReleased),
        }),
      ),
    ),
    Telemetry.group("Lifecycle")(
      Telemetry.event("Started", QueueLifecycleStarted),
      Telemetry.event("Paused", QueueLifecyclePaused),
      Telemetry.event("Resumed", QueueLifecycleResumed),
      Telemetry.event("Drained", QueueLifecycleDrained),
      Telemetry.event("Shutdown", QueueLifecycleShutdown),
    ),
  ),
) {}
```

### Operations API — calling shape (open, owner direction)

Mimic Effect: **function that returns `Effect`**, built with `pipe` / `flatMap` / `gen`.

```ts
const processEntry = (entry: QueueEntryInput) =>
  pipe(
    QueueResourceTelemetry.Entry.processEntry(entry),
    Effect.flatMap((ctx) =>
      Effect.gen(function* () {
        yield* ctx.telemetry.Retried;
        yield* checkRateLimit.pipe(ctx.telemetry.rateLimit);
        return yield* processItem(entry);
      }),
    ),
  );

// kernel
yield* processEntry(entry);
```

- `processEntry(entry)` — first step: takes input, opens operation, returns `Effect` to continue.
- `ctx` — operation context (shape open): likely `{ input, telemetry, leaf, state }`.
- **Shortcuts** (v1 subset TBD): e.g. `.gen(entry, fn)` expanding the pipe above.
- Nested no-input ops (e.g. `rateLimit`): wrap existing `Effect`, no input arg.

Rejected: extra `telemetry` callback param; bodies on `Telemetry.Tag` class.

---

### `start` and `exit`

- `Telemetry.start(name, event)` on tag declares start **event** only; input type on `Telemetry.operation<Input>`.
- Operations API: `processEntry(entry)` typed from `Telemetry.operation<QueueEntryInput>`.
- The **layer** emits the start event and opens scope using that input.
- `Telemetry.exit(…)` on the tag maps outcomes to group events; the **layer**
  emits them when the operation `Effect` completes — not the kernel manually.
- Middle events: zero-arg at call site; layer materializes from scope + telemetry state.
- How start/exit event **schemas** get their fields is a **layer** concern.

```ts
Telemetry.operation<QueueEntryInput>("processEntry")(
  QueueEntryScope,
  Telemetry.start("Started", QueueEntryStarted),
  Telemetry.exit({ … }),
);
```

---

### Telemetry state (layer — not on tag)

Telemetry state fields, reducers, scope extension, and entry cleanup belong in
the **layer** configuration — not in `Telemetry.Tag`.

```ts
// Illustrative — lives on layer config, not tag skeleton:
QueueResourceTelemetry.layer({
  state: {
    extend: [
      [QueueResourceScope, { depth: Telemetry.metric.gauge, inFlight: Telemetry.metric.gauge }],
      [QueueEntryScope, {
        enqueuedAt: Telemetry.metric.timestamp,
        startedAt: Telemetry.metric.timestamp,
        waitMs: Telemetry.metric.duration("enqueuedAt", "startedAt"),
      }],
    ],
  },
});
```

Exact layer config shape is open; the rule is **tag = skeleton, layer = behavior**.

### Store / procedure side decisions from this bake

- Rename the neutral procedure builder away from `ProcessStore` to `Procedure`.
- Keep the triplet chain: `Procedure.payload(Query).success(Result).failure(Error)`.
- `Store.Tag<Self>("ProcessTag")(id, procedures)` rejects resolved procedures.
- `Store.Service<Self>("ProcessTag")(id, procedures)` permits `.resolve(...)`.
- RPC-visible failures are `Schema.TaggedError` classes passed directly on contracts and round-trip through transport failure exits.
- Protocol failures are also `Schema.TaggedError` classes, but live in a shared transport error union separate from declared method failures.

### Module identity files

- Process/resource type identity should not be passed around as unrelated string
literals such as `"RunResource"` when the owning service tag cannot be imported
without circular dependencies.
- Domains that need shared identity across worker, telemetry, store facets, and
projections should get a small identity module:

```ts
export const TypeTag = "@nikscripts/effect-pm/RunResource";
export const TypeId: unique symbol = Symbol.for(TypeTag);
```

- Facets and telemetry definitions import the identity module, not the worker/service
module, when they only need the stable type id.

### Operations API — stress case (Queue `processEntry`, open)

See **Operations API — calling shape** above. Body bind location (layer vs module export) open.

### Telemetry layer — runtime platform (open)

Everything not on tag skeleton and not the calling `pipe`/`flatMap` shape. See
**Open questions (session handoff)** below for full checklist.

Do not put layer config on the `Telemetry.Tag` class body.

---

## Open questions (session handoff)

Return to this section in a later bake session. **Locked:** `Telemetry.Tag`
skeleton only. Everything below is open.

**Branch:** `cursor/telemetry-redesign-bake-faed` · **Plan:** [20](../plans/20-process-store-split-and-telemetry.md) · **Ecosystem:** [22](../plans/22-effect-ecosystem-adapters.md)

### A. Tag skeleton (minor confirms)

- [ ] Subpath/export: `store/QueueResource` re-export vs dedicated telemetry file?
- [ ] Input type param: `Telemetry.operation<Input>` vs elsewhere?
- [ ] `Telemetry.logWarning` on event defs — stays on tag decl or layer-only?
- [ ] Identity module: file name, subpath (`RunResourceIdentity.ts`?)

### B. Operations API (calling)

- [ ] Confirm `pipe(processEntry(input), Effect.flatMap(ctx => gen))` as canonical shape
- [ ] **`OperationContext` fields** — `input`, `telemetry`, `leaf`, `state` — what else?
- [ ] Middle events: `ctx.telemetry.Retried` vs flat `yield* Tag.Entry.Retried` vs both?
- [ ] Where operation handles live — layer context, module export, or generated from tag+layer?
- [ ] **Shortcuts v1** — `.gen(input, fn)` only? `.effect(input, effect)`? none?
- [ ] Nested no-input ops — pipe endomorphism? `ctx.telemetry.rateLimit` signature?
- [ ] Type error when yielding events outside active operation context
- [ ] Defect vs failure vs interrupt — caller-visible or layer-only mapping?

### C. Layer composition

- [ ] Layer constructor: `RunResourceTelemetry.layer({ … })` vs `Telemetry.layer(Tag, …)`?
- [ ] Requires/provides matrix (hub, scopes, sinks) — finalize step 8 table
- [ ] No-op without layer — stub emit vs fail at type level?
- [ ] Explicit combined layers naming (`*Compose.layerPersist`)

### D. Emit pipeline

- [ ] Materialization rules — which event schema fields come from scope / input / exit result / cause / duration?
- [ ] Prepare → metrics → hub ordering (plan 17 legs)
- [ ] Wire id helper API (no raw strings in kernel)
- [ ] Validation before hub emit
- [ ] OccurredAt vs observedAt stamping
- [ ] Correlation: `runId`, resource id, entry id — from scope only?

### E. Telemetry state

- [ ] Layer config DX for fields (gauge, counter, timestamp, duration between fields)
- [ ] Scope extension — merge onto process scopes; process cannot read telemetry fields
- [ ] Parent → leaf inheritance rules (explicit extended parent + leaf scope)
- [ ] Reducers — on which wires / ops updated?
- [ ] **Entry cleanup policy** — when entry-scoped maps are dropped
- [ ] Snapshot/introspection for dashboards — public or internal only?

### F. Registry & sinks

- [ ] Global registry vs per-compose registration
- [ ] Registry init timing (module load vs layer)
- [ ] Sink subscription — by wire id, prefix, facet?
- [ ] Archive vs projection vs broadcast failure isolation
- [ ] `Telemetry.logWarning` behavior on archive persist failure

### G. Hub bridge & kernel boundaries

- [ ] RunResource: which counters leave kernel `Ref` → telemetry state?
- [ ] Gating stays `Semaphore` only — confirm
- [ ] Delete list when bake closes (`defineEvent`, `RunResourceHubTelemetry`, …)

### H. Effect platform integration

- [ ] Tracer spans at operation boundaries — wire to `${typeId}/op/path`?
- [ ] Bridge telemetry state → Effect `Metric`?
- [ ] Test layer — capture emits for assertions

### I. Store/RPC (related, separate from telemetry tag)

- [ ] `Procedure` + `Store.Tag` / `Store.Service` — already decided; implement when?
- [ ] Effect RPC under store transport (plan 16)

### J. Suggested bake order (next sessions)

1. **B + C** — `OperationContext` + layer constructor sketch (Queue stress case)
2. **D + E** — materialization + telemetry state config
3. **F + G** — registry, sinks, RunResource boundary
4. Sign off → update [21-state-vocabulary.md](../plans/21-state-vocabulary.md) → implement slice A (tag skeleton port)

---

## Open recipe steps (bake in order)

Steps 1–2 are **locked** vs **open** as marked. Steps 3–9 remain from the
original bake sequence, updated for `Telemetry.Tag` where noted.

### Step 1 — `Telemetry.Tag` skeleton (**locked**)

**Decides:** Public tag class — contract only; no state, no handlers, no runners.

**Locked shape:** see **Definition surface** above.

**Still to confirm:** subpath, exports, `Telemetry.logWarning` on event defs.

**Acceptance:** Tag file contains skeleton only; golden tree from
`facet-telemetry-158c` ports without adding runtime concerns.

---

### Step 2 — Operations API (**open**)

**Decides:** Canonical calling shape (`pipe` + `flatMap` + `gen`), `OperationContext`,
shortcuts, nested no-input ops.

**Acceptance:** Queue `processEntry(entry)` stress case reads as plain Effect code;
input typed from `Telemetry.operation<Input>`.

---

### Step 3 — Telemetry layer API (**open**)

**Decides:** Layer config for state, scope extension, emit pipeline, registry,
operation handle generation. See **Open questions (session handoff)** §C–G.

**Acceptance:** Tag file unchanged when layer config changes; layer produces
`processEntry(input)` handles.

---

### Step 4 — `Telemetry.registry`

**Decides:** Wire registration, sink subscription, relationship to hub init.

**Recommended ingredients:**

```ts
Telemetry.registry([RunResourceTelemetry, QueueResourceTelemetry])
// → hub knows wire ids + schemas for sink matching
// ArchiveSink / ProjectionSink derive legs from registry + codec — no hand wires
```

- Registration at module init or explicit registry layer (bake choice).
- Sinks opt in by wire id (recipe step 2 locked).
- Archive registry stays separate (`ProcessStore.registry` → archive facets only).

**Acceptance:** Document minimal v1 API; owner signs off on one global registry vs per-compose registration.

---

### Step 5 — Telemetry state API

**Decides:** Service tag, lifetime, who updates, interaction with emit legs.

**Recommended ingredients:**

```ts
// In-memory only; provided by RunResourceTelemetry.layer (or TelemetryState.layer scoped to domain)
interface RunResourceTelemetryState {
  readonly incrementEmit: (wire: string) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<Readonly<Record<string, number>>>
}

// Updated only inside emit pipeline / metrics leg — kernel cannot yield* TelemetryState
```

- Lifetime: same as worker / gate instance (or telemetry compose scope).
- `prepare` / `metrics` pipe legs (plan 17 phase 2) read/write telemetry state before hub emit.
- Never serialized to `RuntimeStorage`.

**Alternatives:** Ref inside hub (rejected — not siloed per domain); reuse projection (rejected).

**Acceptance:** Owner confirms fields, lifetime, and that process code never imports telemetry state.

---

### Step 6 — Hub emit bridge (internal)

**Decides:** How tree statics reach `TelemetryHub.emit` without spine in emit `R`.

**Recommended flow:**

```text
yield* QueueResourceTelemetry.Entry.Retried
  → materialize from event schema + active scope + telemetry state + op context
  → read/update telemetry state (optional leg)
  → TelemetryHub.emit({ wire, schema, payload })
  → sinks (archive / projection / broadcast / logs)
```

Operation start/exit events are emitted by the operation runner (step 2), not by
manual kernel calls. `Telemetry.start` input is consumed only when the runner opens
the operation.

- Persist sink uses `ArchiveSink` + spine — **not** inline in emit `R`.
- `Telemetry.logWarning` applies to archive persist failures on sink path.

**Acceptance:** Sequence diagram signed off; test plan: emit with hub only; emit + archive sink; no store in emit R.

---

### Step 7 — RunResource kernel boundary

**Decides:** What stays in process vs telemetry for gate counters.

**Recommended:**

- Process: `Semaphore`, `RunScope.run` with `runId`, user effect.
- Telemetry: counters (`waiting`, `inFlight`, …) move to **telemetry state** or emit-side reducer; `State.Changed` still emitted via tree.
- Delete kernel-owned `stateRef` once telemetry state exists.

**Acceptance:** Owner confirms which RunResource counters are telemetry-only vs required for gating (gating uses semaphore only).

---

### Step 8 — Layer matrix (siloed vs combined)

**Decides:** Default exports for apps; naming.


| Layer                                  | Requires           | Provides                       |
| -------------------------------------- | ------------------ | ------------------------------ |
| `TelemetryHub.layer`                   | —                  | emit                           |
| `RunResourceTelemetry.layer`           | hub                | state + operations API + emit bridge |
| `RunResourceStore.layerRuntimeStorage` | `RuntimeStorage`   | queries                        |
| `ArchiveSink.layerForStore(...)`       | storage + hub      | persist leg                    |
| `RunResourceProjection.layerLive`      | hub                | live read                      |
| `RunResourceCompose.layerPersist`      | **explicit merge** | convenience                    |


**Acceptance:** Table approved; no monolithic layer pulls all facets + transports without explicit name.

---

### Step 9 — Migration & delete list

**Decides:** What dies on hub branch when bake closes.

**Delete / replace:**

- `TelemetryHub.defineEvent` usage in facet modules
- `RunResourceHubTelemetry` namespace
- Hand-duplicated wire const arrays in `RunResourceStore` / `RunResourceTelemetry`
- Kernel `Ref` counters (after telemetry state)
- Docs referencing `store/runResource/` folders, transport-only parallel agent as primary path

**Keep:**

- `TelemetryHub`, sink modules, projection pilot, transport merge, flat `store/RunResource*.ts`

**Acceptance:** Owner approves delete list; changeset note for breaking emit surface.

---

## Rejected substitutions (record during bake)


| Proposal                                          | Reason                                 |
| ------------------------------------------------- | -------------------------------------- |
| `defineEvent` as SSoT                             | Bypasses plan 17 DSL; caused hub drift |
| Durable `ProcessStore.state` as “telemetry state” | Wrong vocabulary — ops storage         |
| Domain folders under `store/`                     | Owner: role folders only               |
| Procedure `.success` / `.failure` on telemetry ops  | Store/RPC only — telemetry uses `start` / `exit` |
| Operation bodies / handlers on `Telemetry.Tag`    | Tag is skeleton — Operations API + layer |
| Telemetry state on `Telemetry.Tag`                | Tag is skeleton — state on layer       |
| Telemetry counters in kernel `Ref`                | Violates telemetry-only boundary       |


---

## After bake — implementation handoff

1. Update [21-state-vocabulary.md](../plans/21-state-vocabulary.md) with locked step outcomes.
2. Slice A: `Telemetry.Tag` skeleton + restore RunResource tree from `facet-telemetry-158c`.
3. Slice B: Operations API v1 (typed input from `Telemetry.start`).
4. Slice C: telemetry layer v1 (state, bind, hub bridge).
5. Slice D: registry v1 + RunResource kernel cleanup.
6. Slice E: Queue migration on separate branch/worktree.

**Verification (every slice):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

**Changeset:** required before merge to integration branch (owner approval).

---

## Bake session checklist

- [x] Step 1 — `Telemetry.Tag` skeleton locked
- [ ] Step 2 — Operations API locked (`pipe` / `flatMap` / `OperationContext`)
- [ ] Step 3 — telemetry layer API locked (not on tag)
- [ ] Step 4 — registry API locked
- [ ] Step 5 — telemetry state API locked
- [ ] Step 6 — hub bridge flow locked
- [ ] Step 7 — RunResource kernel boundary locked
- [ ] Step 8 — layer matrix locked
- [ ] Step 9 — delete list approved
- [ ] Plan 21 updated with bake outcomes
- [ ] Owner sign-off on vocabulary table (four state words)

