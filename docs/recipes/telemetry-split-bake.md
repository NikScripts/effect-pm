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
| **Operations API** | Separate from Tag (generated or attached at compose) | Open | Run tracked operations: **typed input** from `Telemetry.start`, body as `(input) => Effect` |
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
- `Telemetry.start<Input>(…)` / `Telemetry.exit(…)` declarations
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

### Operations — declaration on tag vs Operations API (open)

**On the tag (declaration only):**

- `Telemetry.operation(...)` names the operation and nests child events/operations.
- First child is the operation **`State.Scope`**.
- `Telemetry.start<Input>(name, event)` declares the **input type** for this operation.
  That `Input` type is what the Operations API uses at the call site — it is not
  a runtime schema on the tag.
- `Telemetry.exit(…)` declares which group events fire on each exit outcome.
- Nested operations without `Telemetry.start` take no operation input.

**Operations API (separate — not on the tag):**

An operation with `Telemetry.start<Input>` is a **function that returns an
Effect**: `(input: Input) => Effect<A, E, R>`. The input type comes from the
tag's `Telemetry.start<Input>` — single source of truth.

```ts
// Input type fixed by tag declaration:
// Telemetry.start<QueueEntryInput>("Started", QueueEntryStarted)

// Operations API — shape TBD; must accept typed input:
yield* processEntry(entry); // entry: QueueEntryInput

// Equivalent: a function returning Effect
const processEntry: (entry: QueueEntryInput) => Effect<…> = …;
```

Inside the body, middle events stay zero-arg (`yield* …Retried`). The layer
provides operation context; the tag only declared that those events exist.

Operations **without** `Telemetry.start` (e.g. nested `rateLimit`) wrap an
existing `Effect` — no input param:

```ts
yield* checkRateLimit.pipe(rateLimit); // rateLimit: <A,E,R>(effect: Effect<A,E,R>) => Effect<…>
```

**Rejected draft** (conflated operations API with tag + extra `telemetry` param):

```ts
// do not use as target shape
QueueResourceTelemetry.Entry.processEntry.gen(function* (entry, telemetry) { … });
```

Open questions for **Operations API** bake:

- Where do `(input) => Effect` handles live — layer output, separate `operations`
  export, or module-level bind?
- One adapter vs `.fn` / `.gen` / `.effect` — or always function-of-input?
- Nested no-input ops: `.wrap(effect)` vs pipe — name and typing.
- Type error when yielding events outside active operation context.

---

### `start` and `exit`

- `Telemetry.start<Input>(name, event)` on the **tag** declares input type + start event wire.
- At **runtime**, the Operations API takes `input: Input` when invoking the operation.
- The **layer** emits the start event and opens scope using that input.
- `Telemetry.exit(…)` on the tag maps outcomes to group events; the **layer**
  emits them when the operation `Effect` completes — not the kernel manually.
- Middle events: zero-arg at call site; layer materializes from scope + telemetry state.
- How start/exit event **schemas** get their fields is a **layer** concern.

```ts
// Tag skeleton only:
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

### Scope and events (call site)

- Normal events: `yield* QueueResourceTelemetry.Entry.Retried` — no payload args.
- Operation input is passed only to the **Operations API** entry point, typed by
  `Telemetry.start<Input>` on the tag — not to individual events.
- `Telemetry.operation` first child on the tag is the operation scope (declaration).

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

Tag declares `Telemetry.start<QueueEntryInput>(…)`. Operations API must surface
`QueueEntryInput` at the entry point. Body is `(input) => Effect` or equivalent.

```ts
// Kernel call site — input visible, typed from Telemetry.start:
yield* processEntry(entry);

// Body bind (wherever it lives — layer config or operations module):
processEntry: (entry: QueueEntryInput) =>
  Effect.gen(function* () {
    yield* QueueResourceTelemetry.Entry.Retried;
    yield* checkRateLimit.pipe(rateLimit); // no-input nested op
    return yield* processItem(entry);
  }),
```

`processEntry` and `rateLimit` handles are **not** methods on the tag class —
they come from the Operations API / layer. The tag only declared their existence
and input type.

### Telemetry layer API (open)

Everything telemetry does beyond the skeleton tag:

| Responsibility | Notes |
| --- | --- |
| Telemetry state | Field declarations, reducers, per-entry cleanup |
| Scope extension | Merge telemetry fields onto process scopes at runtime |
| Operations API output | Provide `(input) => Effect` runners typed from `Telemetry.start` |
| Nested op wrappers | No-input ops: `Effect => Effect` |
| Hub emit bridge | Materialize event payloads → `TelemetryHub.emit` |
| Registry | Wire ids + schemas for sinks |
| Event emit statics | Zero-arg `yield* Tag.Group.Event` inside operation context |

```ts
// Illustrative — shape not locked:
export const layer = QueueResourceTelemetry.layer({
  state: { /* see above */ },
  operations: {
    processEntry: (entry) => Effect.gen(function* () { … }),
  },
});
```

Do not put `operations` or `state` on the `Telemetry.Tag` class body.

---

### Still open (bake order)

1. **Operations API** — where `(input: StartInput) => Effect` handles are exported;
   how input type flows from `Telemetry.start<Input>` on the tag.
2. **Telemetry layer API** — config shape for state, scope extension, operations
   bind, hub bridge, registry.
3. **Telemetry state DX** — field/reducer config on layer; entry cleanup policy.
4. **`start` / `exit` materialization** — layer injects fields into event schemas.
5. **Registry** — global vs per-compose (step 4 below).
6. **Identity module convention** — file placement for `TypeTag` / `TypeId`.

Ecosystem adapters: [22-effect-ecosystem-adapters.md](../plans/22-effect-ecosystem-adapters.md).

---

## Getting back on track

**Branch:** `cursor/telemetry-redesign-bake-faed`.

**Locked:** `Telemetry.Tag` **skeleton** only.

**Not locked — two separate additional APIs:**

1. **Operations API** — typed input from `Telemetry.start`, `(input) => Effect`
2. **Telemetry layer** — state, scope merge, emit bridge, operation bind, registry

**Suggested next bake:** Operations API entry-point shape (show input at call
site), then layer config that produces those runners without bloating the tag.

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

**Decides:** How kernel invokes operations with **typed input** from
`Telemetry.start<Input>`; `(input) => Effect` shape; nested no-input ops.

**Acceptance:** `processEntry(entry: QueueEntryInput)` is typed from tag; input
visible at call site; not a method on the tag class.

---

### Step 3 — Telemetry layer API (**open**)

**Decides:** Layer config for state, scope extension, operation bind, hub bridge,
registry. Everything not on the tag skeleton.

**Acceptance:** Layer produces Operations API handles; tag file unchanged when
layer config changes.

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
- [ ] Step 2 — Operations API locked (typed input from `Telemetry.start`)
- [ ] Step 3 — telemetry layer API locked (not on tag)
- [ ] Step 4 — registry API locked
- [ ] Step 5 — telemetry state API locked
- [ ] Step 6 — hub bridge flow locked
- [ ] Step 7 — RunResource kernel boundary locked
- [ ] Step 8 — layer matrix locked
- [ ] Step 9 — delete list approved
- [ ] Plan 21 updated with bake outcomes
- [ ] Owner sign-off on vocabulary table (four state words)

