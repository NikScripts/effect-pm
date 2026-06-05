# Telemetry split bake — owner prompt (paste this)

**Relative path:** `docs/handoffs/telemetry-split-bake-prompt.md`

**Recipe ledger (write decisions here):** `docs/recipes/telemetry-split-bake.md`  
**Vocabulary:** `docs/plans/21-state-vocabulary.md`

---

## Copy from here ↓

```text
Bake the telemetry split. Documentation only — no src/ changes, no commits.

Read first (repo style + rules):
- docs/AGENTS.md
- docs/STORAGE.md
- docs/plans/21-state-vocabulary.md
- docs/recipes/architecture-split-and-transports.md
- docs/recipes/telemetry-split-bake.md
- .cursor/rules/public-vs-internal.mdc

Session rules:
- ONE step per turn (1→7). Do not preview later steps.
- More code than prose — show the recommended shape as full code (kernel, tree, layers).
- Non-DX decisions: present ONE recommended solution; owner confirms or overrides.
- DX decisions (public API shape, naming, subpaths): recommended + at most ONE alternative, both as full code.
- Wait for my confirmation before locking and advancing.
- On lock: update docs/recipes/telemetry-split-bake.md only (Locked ingredients + checklist). No other files unless I ask.
- Do not implement. Do not edit src/, test/, package.json, or tsup.

Golden tree (port DSL, do not merge branch wholesale):
  git show origin/cursor/facet-telemetry-158c:src/store/runResource.ts

Hub debt (context only):
  src/store/RunResourceTelemetry.ts  — defineEvent
  src/RunResource.ts                 — stateRef, RunResourceHubTelemetry

Start STEP 1 only.
```

---

## Agent playbook

### Before step 1

Skim hub debt + golden tree + `queueResourceTelemetry.ts` (DSL reference). Confirm repo conventions:

| Rule | Source |
| --- | --- |
| Role folders only; flat PascalCase under `store/` | `docs/plans/src-reorganization.md`, `.cursor/rules/public-vs-internal.mdc` |
| Emit `R = TelemetryHub` at kernel | plan 20, architecture recipe |
| Tree DSL = plan 17; not `defineEvent` | plan 17 §5, plan 21 |
| Process state ≠ telemetry state ≠ projection ≠ durable ops | plan 21 |
| Siloed layers; combined layers explicitly named | architecture recipe step 6 |
| Effect platform services; functional `Effect` pipelines | `docs/AGENTS.md` |
| No shims, no `@deprecated` | STORAGE.md, plan 17 policy |

**Allowed edits:** `docs/recipes/telemetry-split-bake.md` (and plan 21 if vocabulary changes).  
**Forbidden:** any `src/`, `test/`, config, or implementation.

---

### Step map — DX vs recommended

| Step | Topic | Owner decides? | Agent default |
| --- | --- | --- | --- |
| **1** | `Telemetry.Service` factory + exports | **DX** — confirm shape/subpath | Class curried like `ProcessStore.Service`; re-export via `store/RunResource` |
| **2** | `Telemetry.registry` | Confirm only | Explicit registry at compose; sinks subscribe by wire id |
| **3** | Telemetry state API | **DX** — tag/fields if needed | In-memory service on telemetry layer; emit legs only; never storage |
| **4** | Hub emit bridge | Confirm only | Tree static → materialize → optional telemetry state → `TelemetryHub.emit` |
| **5** | RunResource kernel boundary | Confirm only | Semaphore + `RunScope` in process; counters in telemetry state |
| **6** | Layer matrix | Confirm only | Table in recipe (already locked in architecture) |
| **7** | Delete list + migration order | Confirm only | Recipe delete list; RunResource → Queue |

For **non-DX** steps: lead with recommended code, short “confirm or override”.  
For **DX** steps: recommended code + one alternative code block, then ask which to lock.

---

## Step 1 (DX) — recommended: `class Telemetry.Service` mirrors `ProcessStore.Service`

**Today → target:**

```ts
// GOLDEN (facet-telemetry-158c) — DSL correct, coupled to store spine
const RunResourceTelemetry = ProcessStore.telemetry(RunResourceScope)(
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(
    Telemetry.event("Started", RunResourceRunStarted).pipe(
      Telemetry.logWarning("RunResourceStore write failed for run start", ({ runId }) => ({
        runId: String(runId),
      })),
    ),
    Telemetry.event("Completed", RunResourceRunCompleted).pipe(/* ... */),
    Telemetry.event("Failed", RunResourceRunFailed).pipe(/* ... */),
  ),
  Telemetry.tag("State")(
    Telemetry.event("Changed", RunResourceStateChanged).pipe(/* ... */),
  ),
);

// HUB DEBT — wrong surface, right decoupling
export const RunStarted = defineEvent({ namespace: "RunResource", tagPath: ["Run"], name: "Started", schema });
yield* RunResourceHubTelemetry.State.changed(input); // R = TelemetryHub

// TARGET — same DSL, new factory, hub emit
export class RunResourceTelemetry extends Telemetry.Service<RunResourceTelemetry>()(
  "@nikscripts/effect-pm/store/RunResource/RunResourceTelemetry",
  RunResourceScope,
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(
    Telemetry.event("Started", RunResourceRunStarted).pipe(
      Telemetry.logWarning("RunResource archive persist failed for Run.Started", ({ runId }) => ({
        runId: String(runId),
      })),
    ),
    Telemetry.event("Completed", RunResourceRunCompleted).pipe(/* ... */),
    Telemetry.event("Failed", RunResourceRunFailed).pipe(/* ... */),
  ),
  Telemetry.tag("State")(
    Telemetry.event("Changed", RunResourceStateChanged).pipe(/* ... */),
  ),
) {}

// src/RunResource.ts
yield* RunResourceTelemetry.Run.Started({ runId, occurredAt, payload: { concurrency } });
// Effect<void, TelemetryHubError, TelemetryHub>

// src/store/RunResource.ts — single subpath entry (recommended)
export { RunResourceTelemetry } from "./RunResourceTelemetry";
export { RunResourceStore } from "./RunResourceStore";
```

**DX alternative (only if owner rejects class):** `const` tree + `Telemetry.Service.attach({ tree, emit })` — same static paths, no `extends` class. Show only if asked.

**Lock in recipe:** factory form, subpath (`store/RunResource` re-export vs dedicated subpath), DSL unchanged from golden.

---

## Step 2 (non-DX) — recommended: explicit registry at compose

```ts
// Registry — separate from ProcessStore.registry (archives only)
Telemetry.registry([RunResourceTelemetry, QueueResourceTelemetry]);
// Registers wire ids + schemas for hub + sink matching

// ArchiveSink / ProjectionSink derive legs from registry + codec — no hand wire arrays
ArchiveSink.layerForStore(RunResourceStore, archiveLegs); // legs from Telemetry.codec(tree)

// Compose site (app or RunResourceCompose)
Layer.provideMerge(
  TelemetryHub.layer,
  Telemetry.registryLayer([RunResourceTelemetry]),
);
```

Owner confirms or overrides global vs per-compose registration.

---

## Step 3 (DX) — recommended: telemetry state on telemetry layer

```ts
// Architecture (non-DX — fixed): in-memory, telemetry path only, never RuntimeStorage

export class RunResourceTelemetryState extends Context.Tag(
  "@nikscripts/effect-pm/store/RunResource/RunResourceTelemetryState",
)<RunResourceTelemetryState, {
  readonly increment: (wire: string) => Effect.Effect<void>;
  readonly snapshot: Effect.Effect<Readonly<Record<string, number>>>;
}>() {}

// Provided by RunResourceTelemetry.layer — NOT importable from src/RunResource.ts
// Updated inside emit pipeline / metrics leg before hub.emit

RunResourceTelemetry.layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const counts = yield* Ref.make<Record<string, number>>({});
    yield* Layer.succeed(RunResourceTelemetryState, {
      increment: (wire) => Ref.update(counts, (c) => ({ ...c, [wire]: (c[wire] ?? 0) + 1 })),
      snapshot: Ref.get(counts),
    });
  }),
).pipe(Layer.provideMerge(/* tree statics + hub bridge */));
```

**DX fork (if any):** service tag name or colocation (`RunResourceTelemetryState` vs shared `TelemetryState` scoped by domain).

---

## Step 4 (non-DX) — recommended: hub bridge sequence

```ts
// Internal — tree static does not require RuntimeStorage in R
RunResourceTelemetry.Run.Started(input) =>
  Effect.gen(function* () {
    const scoped = yield* materializeFromScope(RunScope, input); // process state read OK
    yield* incrementTelemetryState(RUN_STARTED_WIRE);            // optional leg
    const hub = yield* TelemetryHub;
    yield* hub.emit({ wire: RUN_STARTED_WIRE, schema, payload: scoped });
  });

// ArchiveSink (optional layer) — spine + persist; failures logWarning + swallow
// ProjectionSink — reducer from same schema
// BroadcastSink — telemetryTransport
```

---

## Step 5 (non-DX) — recommended: kernel boundary

```ts
// PROCESS (keep)
const semaphore = yield* Semaphore.make(concurrency);
yield* RunScope.run({ runId, /* ... */ }, userEffect);

// TELEMETRY (move off kernel Ref)
// waiting / inFlight / completed / failed / interrupted / totalDurationMs
// → telemetry state + State.Changed emit via tree

// DELETE from src/RunResource.ts when telemetry state lands
const stateRef = yield* Ref.make<RunResourceState>({ ... }); // debt
yield* RunResourceHubTelemetry.State.changed({ ... });       // debt
```

Gating uses **semaphore only** — counters are observability-only.

---

## Step 6 (non-DX) — recommended: layer matrix (from architecture recipe)

```ts
TelemetryHub.layer                              // emit router
RunResourceTelemetry.layer                      // tree + telemetry state; requires hub
RunResourceStore.layerRuntimeStorage            // queries; requires RuntimeStorage
ArchiveSink.layerForStore(RunResourceStore, archiveLegs)  // optional persist
RunResourceProjection.layerLive                 // optional live read
RunResourceCompose.layerPersist                 // explicit merge — convenience only
```

No monolithic “everything” layer without an explicit name.

---

## Step 7 (non-DX) — recommended: delete list + order

```text
Delete/replace on hub branch:
  TelemetryHub.defineEvent in facet modules
  RunResourceHubTelemetry
  Hand-duplicated wire arrays in RunResourceStore / RunResourceTelemetry
  Kernel stateRef counters (after step 3)

Keep:
  TelemetryHub, sink/*, RunResourceProjection, flat store/RunResource*.ts, transport merge

Order:
  1 RunResource tree + Telemetry.Service
  2 hub bridge + Telemetry.registry
  3 telemetry state + kernel cleanup
  4 Queue on cursor/queue-telemetry-hub-migration
```

---

## End of bake

Update checklist in `docs/recipes/telemetry-split-bake.md`.  
If vocabulary changed, patch `docs/plans/21-state-vocabulary.md`.  
Tell owner: ready for implementation handoff — **changeset** before merge to `rewrite/store-transport`.

---

## Reference commands (read-only)

```sh
git show origin/cursor/facet-telemetry-158c:src/store/runResource.ts
cat src/store/RunResourceTelemetry.ts
cat src/store/queueResourceTelemetry.ts
cat src/RunResource.ts
cat src/store/RunResource.ts
```
