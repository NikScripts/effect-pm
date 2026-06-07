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

**Only the `Telemetry.Tag` definition DX is locked.** Everything else — runtime
operation API, telemetry state, layer construction, registry, hub bridge — is
still open.

Two separate public APIs:

| API | Status | Purpose |
| --- | --- | --- |
| **`Telemetry.Tag` definition** | Locked (shape below) | Contract: namespaces, groups, operations, events, scopes, telemetry state fields |
| **Operation runtime** | Open — explore options | How kernel code runs inside a tracked operation (start/exit, nested ops, local events) |
| **Telemetry layer** | Open | How definition becomes a `Layer`: hub wiring, scope extension, state, generated handles |

`Procedure.payload().success().failure()` belongs to **`Store.Tag` / RPC only** —
not telemetry. Telemetry has **`namespace`**, **`group`**, **`operation`**, and
**`event`**. Wire ids are always **`Namespace.Group.Event`**. Operations nest and
carry **`Telemetry.start`** / **`Telemetry.exit`** helpers; there are no
`.success` / `.failure` selectors on telemetry operations.

---

### Definition surface (locked)

- Telemetry definitions move to contract-style `Telemetry.Tag`; runtime / layer creation is separate.
- `Telemetry.Service` is optional convenience only; built-in package code should not rely on it as the main shape.
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
      Telemetry.operation("processEntry")(
        QueueEntryScope,
        Telemetry.start<QueueEntryInput>("Started", QueueEntryStarted),
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

### Operations (definition only — runtime API open)

- `Telemetry.operation(...)` defines a tracked operation in the tag tree.
- First child is the operation **`State.Scope`** (leaf scope for this operation).
- Optional `Telemetry.start<Input>(name, event)` — only place operation input is consumed.
- Optional `Telemetry.exit({ onSuccess, onFailure, onInterrupt, … })` — maps
  `Effect.Exit` outcomes to **group events** (no `Exit` wire segment).
- Nested `Telemetry.operation(...)` and `Telemetry.event(...)` are children;
  they exist for local access inside the operation body and for tracing identity
  `${typeId}/${operation/path}` — not for wire ids.
- Operation names are camelCase.
- Use operations only when tracking the function/effect itself is valuable.

**Draft runtime (not locked — placeholder in docs):**

```ts
const processEntry = QueueResourceTelemetry.Entry.processEntry.gen(
  function* (entry, telemetry) {
    yield* telemetry.Retried;
    yield* checkRateLimit.pipe(telemetry.rateLimit.effect(entry));
    return yield* processItem(entry);
  },
);
```

Problems with this draft: extra `telemetry` param, `.gen` / `.fn` / `.effect`
multiplicity, awkward pipe for nested ops. See **Operation runtime — options to
explore** below.

### `start` and `exit`

- `Telemetry.start<Input>(name, schema)` is a special operation prelude, not an exit case.
- `Telemetry.start` is optional; not every operation records a start event.
- `Telemetry.start` may see the operation input and is the only event helper expected to consume operation input.
- `Telemetry.exit(...)` maps operation outcomes to regular event definitions.
- `Telemetry.exit` does not create an `Exit` wire segment.
- How start/exit events materialize fields (scope, input, result, cause, duration,
  telemetry state) is **open** — resolved when runtime + layer APIs are designed.
- Middle events and exit events do not take call-site payloads; fields come from
  scope / telemetry state / operation context established by the layer.

```ts
Telemetry.operation("processEntry")(
  QueueEntryScope,
  Telemetry.start<QueueEntryInput>("Started", QueueEntryStarted),
  Telemetry.exit({
    onSuccess: Telemetry.event("Completed", QueueEntryCompleted),
    onFailure: Telemetry.event("Failed", QueueEntryFailed),
    onInterrupt: Telemetry.event("Released", QueueEntryReleased),
  }),
);
```

### Scope, event input, and telemetry state

- Events have no input, all fields can be derived from active `State.Scope`, terminal values, telemetry state, or exit/cause context:
`yield* QueueResourceTelemetry.Entry.Started`.
- The exception is Telemetry.start which is defined like a function but actual implementation is unclear.
- `Telemetry.operation` first child is the operation scope.
- Operation input is a TypeScript type parameter, not a schema.
- Telemetry state imports process scopes and extends them in telemetry definitions; it does not mutate process schemas.
- Telemetry state inheritance is explicit: a leaf telemetry extension gets parent telemetry fields only when extending from an already-extended parent plus the leaf process scope.
- Scope identity comes from process `State.Scope`; telemetry state should not create a separate identity tree.
- Typed string enforcement applies to **`State.Scope`** field paths and other
  string-keyed helpers in this package — not Procedure-style `.success` /
  `.failure` on telemetry (those are store/RPC only).

```ts
const QueueTelemetry = Telemetry.State.extend(QueueResourceScope, {
  depth: Telemetry.metric.gauge,
  inFlight: Telemetry.metric.gauge,
});

const QueueEntryTelemetry = QueueTelemetry.extend(QueueEntryScope, {
  enqueuedAt: Telemetry.metric.timestamp,
  startedAt: Telemetry.metric.timestamp,
  waitMs: Telemetry.metric.duration("enqueuedAt", "startedAt"),
});
```

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

### Operation runtime — options to explore

Goal: less boilerplate than `(entry, telemetry) => …`, no redundant param, nested
ops feel natural, start/exit automatic from definition, middle events stay
zero-arg `yield* …Event`.

| Option | Sketch | Pros | Cons |
| --- | --- | --- | --- |
| **A. Scope-style `run`** | `processEntry.run(entry, Effect.gen(…))` | Mirrors `State.Scope.run`; explicit scope boundary | Still verbose; where do child events live on the handle? |
| **B. Generated `Effect.fn`** | `const processEntry = Tag.Entry.processEntry(Effect.fn(function*(entry) { … }))` | Familiar Effect.fn; definition attaches at module init | When is layer required vs definition-only export? |
| **C. Operation as pipe** | `yield* entry.pipe(Tag.Entry.processEntry, Effect.gen(…))` | Composable | Unusual; typing nested ops is hard |
| **D. Context-only events** | Inside op, `yield* Tag.Entry.Retried` (flat path); layer sets op context | No `telemetry` param; same paths as wire tree | Needs op-context tag; events outside op must fail at type level |
| **E. Layer-provided service** | `yield* QueueResourceTelemetry.processEntry(entry)` where service wraps body | Clean call site in kernel | Body registration separate from definition unless code-generated |
| **F. Dual: define + register** | Tag defines contract; `Telemetry.layer({ handlers: { processEntry: … } })` binds bodies | Clean separation definition/runtime | Two places to maintain unless codegen links them |
| **G. Hybrid (leading candidate)** | Outer `.run(input, body)` or bound `Effect.fn`; nested no-start ops use `.wrap(effect)`; flat tag paths for events | No `telemetry` param; Scope-like boundary; nested ops without start | Layer + type-level op context required |

Open questions for runtime bake:

- One adapter (`.run` only) vs `.fn` / `.gen` / `.effect` at call site?
- Nested operation invocation: pipe, method on parent op handle, or flat tag path?
- Is operation input only passed to `run` / outer wrapper, never to middle events?
- Type error when yielding group events outside an active operation context?

#### Queue `processEntry` stress-case sketches (not locked)

**G1 — Scope-style `.run` + flat event paths (option A + D):**

```ts
yield* QueueResourceTelemetry.Entry.processEntry.run(entry, Effect.gen(function* () {
  yield* QueueResourceTelemetry.Entry.Retried;
  yield* checkRateLimit.pipe(QueueResourceTelemetry.Entry.rateLimit.wrap);
  return yield* processItem(entry);
}));
```

**G2 — Module-level `Effect.fn` bind (option B):**

```ts
export const processEntry = QueueResourceTelemetry.Entry.processEntry(
  Effect.fn(function* (entry: QueueEntryInput) {
    yield* QueueResourceTelemetry.Entry.Retried;
    yield* checkRateLimit.pipe(QueueResourceTelemetry.Entry.rateLimit.wrap);
    return yield* processItem(entry);
  }),
);
```

**G3 — Layer handler map (option F):**

```ts
export const layer = QueueResourceTelemetry.layer({
  handlers: {
    processEntry: Effect.fn(function* (entry: QueueEntryInput) {
      yield* QueueResourceTelemetry.Entry.Retried;
      yield* checkRateLimit.pipe(QueueResourceTelemetry.Entry.rateLimit.wrap);
      return yield* processItem(entry);
    }),
  },
});
```

Notes:

- `rateLimit` has no `Telemetry.start` — nested op uses `.wrap(effect)` only.
- Middle / exit events stay zero-arg; layer materializes payloads from scope + op context.
- `.wrap` name is illustrative — final adapter name decided in runtime bake.

### Telemetry layer — options to explore (open)

The layer turns a `Telemetry.Tag` definition into runtime services. Likely
responsibilities (exact API not locked):

```ts
// shape TBD — not locked
RunResourceTelemetry.layer
// or
Telemetry.layer(RunResourceTelemetry, { /* scope extensions, state initializers */ })
```

| Responsibility | Notes |
| --- | --- |
| Register wire ids + schemas | For hub / sinks (registry TBD) |
| Extend process scopes | Merge telemetry state fields onto `State.Scope` leaves at runtime |
| Provide operation runners | Whatever runtime option wins above |
| Hub emit bridge | Materialize event payloads → `TelemetryHub.emit` |
| Telemetry state lifetime | Per resource / per entry cleanup policy TBD |

See steps 2–4 and 6 below for hub bridge and layer matrix — **must be rewritten
for `Telemetry.Tag`**, not `Telemetry.Service`.

### Still open (bake order)

1. **Operation runtime API** — pick or hybrid from options A–F.
2. **Telemetry layer API** — constructor shape, inputs, what it provides to context.
3. **Telemetry state DX** — `Telemetry.State.extend`, reducers, entry cleanup.
4. **`start` / `exit` materialization** — what the layer injects into event schemas.
5. **Registry** — global vs per-compose (step 2 below).
6. **Identity module convention** — file placement for `TypeTag` / `TypeId`.

Ecosystem adapters: [22-effect-ecosystem-adapters.md](../plans/22-effect-ecosystem-adapters.md).

---

## Getting back on track

**Branch:** `cursor/telemetry-redesign-bake-faed`.

**Locked:** `Telemetry.Tag` definition DX only (`namespace` / `group` / `operation` /
`event` / `start` / `exit`, wire rule, nesting rules).

**Not locked:** operation runtime, telemetry layer, telemetry state, registry, hub
bridge details, identity placement.

**Suggested next bake session:** compare operation runtime options (table above)
using Queue `processEntry` as the stress case — nested `rateLimit`, middle
`Retried`, optional start, exit mapping — then derive layer API from the winning
runtime shape (layer must know scopes, state extensions, and how ops bind to
bodies).

**Then:** rewrite steps 1–7 below for `Telemetry.Tag`, sign off, implement.

---

## Open recipe steps (bake in order)

Steps 1–2 are **locked** vs **open** as marked. Steps 3–9 remain from the
original bake sequence, updated for `Telemetry.Tag` where noted.

### Step 1 — `Telemetry.Tag` definition (**locked**)

**Decides:** Public class API, subpath, exports.

**Locked shape:** see **Definition surface** above (`namespace` / `group` /
`operation` / `event` / `start` / `exit`).

**Still to confirm:** subpath (`store/QueueResource` re-export vs dedicated file),
identity module placement, `Telemetry.logWarning` pipe on event definitions.

**Acceptance:** Owner confirms exports match role-folder rules; golden tree from
`facet-telemetry-158c` ports to this shape without DSL changes.

---

### Step 2 — Operation runtime API (**open**)

**Decides:** How kernel code runs inside tracked operations; nested op invocation;
call-site adapter(s).

**Options:** A–G in **Operation runtime — options to explore**; stress-case
sketches G1–G3.

**Acceptance:** Owner picks runtime shape (or hybrid); nested `rateLimit` without
start + middle `Retried` typecheck and read cleanly at call site.

---

### Step 3 — Telemetry layer API (**open**)

**Decides:** Constructor shape; what the layer puts in context; relationship to
runtime handlers.

**Responsibilities:** see **Telemetry layer — options to explore** above.

**Acceptance:** Layer API derivable from step 2 choice; documents requires/provides
for step 8 matrix.

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
| `RunResourceTelemetry.layer`           | hub                | operation runners + telemetry state + emit statics |
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
| Procedure `.success` / `.failure` on telemetry    | Store/RPC only — telemetry uses `start` / `exit` + events |
| Telemetry counters in kernel `Ref`                | Violates telemetry-only boundary       |


---

## After bake — implementation handoff

1. Update [21-state-vocabulary.md](../plans/21-state-vocabulary.md) with locked step outcomes.
2. Slice A: `Telemetry.Tag` + restore RunResource tree from `facet-telemetry-158c`.
3. Slice B: operation runtime + telemetry layer v1.
4. Slice C: hub bridge + registry v1.
5. Slice D: telemetry state v1 + RunResource kernel cleanup.
6. Slice E: Queue migration on separate branch/worktree.

**Verification (every slice):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

**Changeset:** required before merge to integration branch (owner approval).

---

## Bake session checklist

- [x] Step 1 — `Telemetry.Tag` definition shape locked
- [ ] Step 2 — operation runtime API locked
- [ ] Step 3 — telemetry layer API locked
- [ ] Step 4 — registry API locked
- [ ] Step 5 — telemetry state API locked
- [ ] Step 6 — hub bridge flow locked
- [ ] Step 7 — RunResource kernel boundary locked
- [ ] Step 8 — layer matrix locked
- [ ] Step 9 — delete list approved
- [ ] Plan 21 updated with bake outcomes
- [ ] Owner sign-off on vocabulary table (four state words)

