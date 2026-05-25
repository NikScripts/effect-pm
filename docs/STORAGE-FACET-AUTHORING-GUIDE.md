# Storage facet authoring guide (`ProcessStoreBuilder.Service`)

**Read first.** Required reading before you touch any facet:

1. [`STORAGE-AGENT-HANDBOOK.md`](./STORAGE-AGENT-HANDBOOK.md) — the master handbook (parts, target architecture, scope rules, verification commands).
2. [`STORAGE.md`](./STORAGE.md) — one-stack contract (`RuntimeStorage` + per-domain facets).
3. [`AGENTS.md`](./AGENTS.md) and `.cursor/rules/public-vs-internal.mdc` — invariants.

**Who this guide is for.** You are an agent picking up a part (B–Y) from the handbook whose feature module **already has a storage integration** that:

- Hand-rolls a `Context.Service` for the facet, or
- Hangs query namespaces on the legacy `ProcessStore` monolith (`ProcessStore.runtime.*`, `ProcessStore.runResource.*`, …), or
- Routes writes through a generic envelope (`RuntimeFact` / `RuntimeRef` / `runtime.fact.recorded`) instead of owning a per-domain event type, or
- Uses an in-process "provide a fake service" listener pattern that the feature module's docs claim is durable storage.

Your job is to **dismantle that legacy wiring** and re-implement the facet on top of [`ProcessStoreBuilder.Service`](#what-processstorebuilderservice-gives-you), with **one facet per domain**, fully domain-typed.

> ⚠️ **Non-negotiables from the handbook.**
>
> - No backwards compatibility. Remove every legacy export; do not deprecate.
> - **Strictly per-domain.** No shared generic envelope appears in any facet's public API. `RuntimeFact` / `RuntimeRef` / `RuntimeStateChange` / `RuntimeStateBase` no longer exist in the public surface — if your feature module imports them, that import is the smell.
> - **Storage is fully optional** and never changes the feature's success/error channel. The facet's static emitters wrap each call with built-in `catchCause + logWarning`.
> - Stay strictly inside your part's files. Do **not** drive-by edit other facets.

---

## The reference cut-over (read this once)

The cleanest existing example is **`RunResource` → `ProcessStoreRunResource`**:

| Concern | Before (legacy) | After (your target) |
|---|---|---|
| Facet module | `src/store/runtime.ts` (`ProcessStoreRuntime`) — shared sink for every "runtime" domain | `src/store/runResource.ts` (`ProcessStoreRunResource`) — owns RunResource only |
| Wire event types | `runtime.fact.recorded`, `runtime.state.changed` (generic) | `run-resource.fact.recorded`, `run-resource.state.changed` (per-domain) |
| Public fact type | `RuntimeFact<RunResourcePayload>` with `ref: { kind, id }` | `RunResourceFact` (discriminated union, flat `resourceId`/`runId`) |
| Public state type | `extends RuntimeStateBase` with `ref` | `RunResourceState` (concrete, `resourceId` flat) |
| Emit API | One generic `recordFact` / `recordStateChange` | Per-type `recordRunStarted` / `recordRunCompleted` / `recordRunFailed` / `recordStateChange` |
| Failure isolation | Removed `persistRuntimeObservation` helper | Built into `ProcessStoreBuilder.Service` — every static emitter wraps with `catchCause + logWarning` |
| Read API | `facts({ ref })`, `runResourceFacts(...)` | `facts({ resourceId, runId, types })`, `runs(resourceId)`, `byRun(runId)`, `latestState(resourceId)` |
| In-process observation | "Provide a custom `ProcessStoreRuntime`-shaped service" — pretended to be storage | Still custom service for now (typed as `ProcessStoreRunResource.Type`). Planned future: `live(resourceId): Stream<...>` |

Files that landed in the cut-over (use these as templates):

- `src/store/runResource.ts` — facet definition, types, projections.
- `src/internal/store/factEnvelope.ts` — **internal-only** shared envelope retained for facets that have not yet been per-domain'd.
- `src/internal/store/spine.ts` — added `run-resource.*` query helpers and a deterministic event-id tiebreaker on `byTimestampDesc`.
- `src/internal/store/codec.ts` — encode + decode for the two new wire event types.
- `src/ProcessStoreEvent.ts` — added `RunResourceFactRecordedEvent` / `RunResourceStateChangedEvent`; demoted generic envelope types to `@internal`.
- `src/ProcessStore.ts` — combiner merges `ProcessStoreRunResource.layerRuntimeStorage`.
- `src/storage/sqlite/index.ts` — `layerProcessStore` advertises `ProcessStoreRunResource` in its return type.
- `src/RunResource.ts` — module-level publish calls are now per-type, domain-typed.
- `src/index.ts`, `package.json` (`./store/RunResource`), `tsup.config.ts` — subpath plumbing.
- `test/process-store-run-resource-facet.test.ts` — conformance suite (no-op vs persist, failure isolation, projections, phantom types).

If your feature module's old integration looks like the "Before" column above, your migration follows the same shape.

---

## What `ProcessStoreBuilder.Service` gives you

A facet authored with the builder is a `Context.ServiceClass` with:

1. **One `record` block** — the writers (`recordX(input)`). The builder probes this block at module load to discover writer names, then synthesises **static optional emitters** on the class for each one.
2. **One `read` block** — the queries (`facts(query)`, `latestState(id)`, …).
3. **Static optional emitters** — call them with or without the facet layer composed:
   - **Layer absent:** silent no-op (returns `Effect.void`).
   - **Layer present:** forwards to the instance method.
   - **Either way:** wrapped with `Effect.catchCause + Effect.logWarning("<id> write failed for <method>")` so storage failures never propagate into the caller's success/error channel.
4. **`Type` / `EmitType` phantom statics** — exposed via a sibling `declare namespace` so callers can write `MyFacet.Type` (full shape) or `MyFacet.EmitType` (record-only) without conditional-inference helpers.
5. **`layerRuntimeStorage`** — `Layer<Facet, never, RuntimeStorage>` (what the combiner uses).
6. **`layer`** — `Layer<Facet, never, never>` (in-memory storage; dev/test only).

You do **not** hand-write `Effect.flatMap` wrappers, optional-presence Option matches, or failure-isolation try/catch. Those are part of the builder.

### Boilerplate skeleton (copy this)

```ts
// src/store/<myDomain>.ts
import { Effect, Option } from "effect";
import { ProcessStoreBuilder } from "../ProcessStoreBuilder";
import { applyQueryOpts, byTimestampDesc } from "../internal/store/spine";
import type {
  MyDomainFactRecordedEvent,
  MyDomainStateChangedEvent,
  QueryOpts,
} from "../ProcessStoreEvent";

// ── Public types (concrete, no generic envelope) ────────────────────────
export interface MyDomainRef { readonly entityId: string }

export type MyDomainFactType =
  | "my-domain.thing.happened"
  | "my-domain.thing.failed";

export interface MyDomainThingHappenedFact {
  readonly id: string;
  readonly entityId: string;
  readonly type: "my-domain.thing.happened";
  readonly occurredAt: number;
  readonly payload: { readonly bytes: number };
}
// … other concrete fact types …

export type MyDomainFact =
  | MyDomainThingHappenedFact
  | /* … */;

export interface MyDomainState {
  readonly entityId: string;
  readonly observedAt: number;
  readonly configVersion: number;
  // … your domain fields …
}

export interface MyDomainStateChange {
  readonly id: string;
  readonly entityId: string;
  readonly changedAt: number;
  readonly reason: string;
  readonly previous: MyDomainState | null;
  readonly current: MyDomainState;
}

export interface MyDomainFactQuery {
  readonly entityId?: string;
  readonly types?: ReadonlyArray<MyDomainFactType>;
  readonly opts?: QueryOpts;
}

// ── Encoders (fact → wire event) ────────────────────────────────────────
const toFactEvent = (fact: MyDomainFact): MyDomainFactRecordedEvent => ({
  id: `my-domain.fact/${fact.id}`,
  type: "my-domain.fact.recorded",
  occurredAt: fact.occurredAt,
  entityType: "my-domain",
  entityId: fact.entityId,
  fact,
});

const toStateEvent = (change: MyDomainStateChange): MyDomainStateChangedEvent => ({
  id: `my-domain.state/${change.id}`,
  type: "my-domain.state.changed",
  occurredAt: change.changedAt,
  entityType: "my-domain",
  entityId: change.entityId,
  change,
});

// ── Facet ───────────────────────────────────────────────────────────────
export class ProcessStoreMyDomain extends ProcessStoreBuilder.Service<
  ProcessStoreMyDomain
>()(
  "@nikscripts/effect-pm/store/myDomain/ProcessStoreMyDomain",
  ProcessStoreBuilder.record((s) => ({
    recordThingHappened: (fact: MyDomainThingHappenedFact) =>
      s.append(toFactEvent(fact)),
    recordStateChange: (change: MyDomainStateChange) =>
      s.append(toStateEvent(change)),
    // … one writer per logical event type …
  })),
  ProcessStoreBuilder.read((s) => ({
    facts: (query?: MyDomainFactQuery) =>
      s.events(/* per-domain StoreEventQuery */).pipe(
        Effect.map((events) => /* filter + project */),
      ),
    // … latestState, byEntity, etc. …
  })),
) {}

export declare namespace ProcessStoreMyDomain {
  export type Type = ProcessStoreBuilder.Service.Type<typeof ProcessStoreMyDomain>;
  export type EmitType = ProcessStoreBuilder.Service.EmitType<typeof ProcessStoreMyDomain>;
}
```

---

## Step-by-step migration (use this checklist on your part)

### 1. Inventory the legacy surface

Before editing anything, list:

- Every type your module exports that mentions the generic envelope (`RuntimeFact`, `RuntimeRef`, `RuntimeStateBase`, `RuntimeStateChange`). These are gone from the public API — your part owns replacements.
- Every place your feature module imports a facet tag (`ProcessStoreRuntime`, `ProcessStore`, `ProcessStoreInterface`).
- Every `store.append(...)` or `store.events(...)` call in feature code — those bypass facets.
- Every place a doc / example tells users to "provide a custom `ProcessStoreRuntime`-shaped service" — those promises will move to your new facet's `.Type` accessor.

If you can hand the maintainer a "before list" up front, the migration goes faster.

### 2. Design domain-typed replacements

Write down your domain's:

- **`*Ref`** (or a flat `entityId: string` if a single discriminator suffices — prefer flat).
- **`*FactType`** discriminator string union.
- **`*StateChangeReason`** string union (if you have state transitions).
- One concrete `*Fact` interface per fact type (no generic payload param — concrete typed fields).
- `*Fact` as a discriminated union of those interfaces.
- **`*State`** concrete state snapshot.
- **`*StateChange`** with `previous: *State | null; current: *State`.
- **`*FactQuery`** with whatever filters you need (`entityId`, `runId`, `types`, `opts`).
- **`*StateHistoryQuery`** (optional, if state history matters).
- **Wire event types** in `ProcessStoreEvent.ts`:
  - `<MyDomain>FactRecordedEvent` (type literal `"my-domain.fact.recorded"`)
  - `<MyDomain>StateChangedEvent` (type literal `"my-domain.state.changed"`)
- **Projections** — what does the operator want to query? Pairing? Latest snapshot? Active vs. completed?

**No generic envelopes in the public API.** If you reach for `RuntimeFact<MyPayload>` or `RuntimeRef<"my-domain">`, stop. Write concrete shapes.

### 3. Wire the spine + codec for the new event types

In `src/internal/store/codec.ts`:

1. Add new cases to `encodeEvent` (`<MyDomain>FactRecordedEvent` / `<MyDomain>StateChangedEvent`).
2. Add new cases to `decodeEventRow`.
3. Add `decode<MyDomain>FactValue` / `decode<MyDomain>StateChangeValue` helpers that return concrete domain types (never the internal `FactEnvelope*`).
4. Add a constant array + `is<MyDomain>FactType` guard for the fact-type discriminator.

In `src/internal/store/spine.ts`:

1. Add the wire type strings to `isLegacyEventRecordType` so records persisted with those types decode back through the codec.
2. Add per-domain helpers: `<myDomain>FactStoreQuery(query)`, `<myDomain>FactsFromEvents(events, query)`, `<myDomain>StateChangedEventQuery(entityId)`, `<myDomain>StateChangesFromEvents(events, entityId)`.

In `src/ProcessStoreEvent.ts`:

1. Export `<MyDomain>FactRecordedEvent` / `<MyDomain>StateChangedEvent` as `@public`.
2. Add both to the `AnalyticsEvent` union.
3. **Do not** add new `*Query` types here unless the spine needs them — query types live in the facet module.

### 4. Write the facet module

Follow the skeleton above. Put it in `src/store/<myDomain>.ts`. Pick **one** file-naming style (`myDomain.ts` or `ProcessStoreMyDomain.ts`) and stick to it.

**Service-key convention:** `"@nikscripts/effect-pm/store/<MyDomain>/ProcessStoreMyDomain"`.

**Required surfaces on the namespace:** `layerRuntimeStorage`, `layer` (both auto-attached by the builder), `Type`, `EmitType` (via the sibling `declare namespace`). Nothing else.

### 5. Migrate the feature module's publish sites

Replace generic `recordFact({ id, ref, type, occurredAt, payload })` with per-type calls:

```ts
// Before (legacy generic envelope)
yield* ProcessStoreRuntime.recordFact({
  id: `${runId}/run-resource.run.started`,
  ref: { kind: "run-resource", id: resourceId },
  type: "run-resource.run.started",
  occurredAt,
  payload: { concurrency },
});

// After (per-type, domain-typed)
yield* ProcessStoreRunResource.recordRunStarted({
  id: `${runId}/run-resource.run.started`,
  resourceId,
  runId,
  type: "run-resource.run.started",
  occurredAt,
  payload: { concurrency },
});
```

The static emitter still no-ops silently when the facet layer is absent — you do **not** wrap with `Effect.serviceOption` yourself.

If your old module exported domain-specific aliases that wrapped the generic envelope (`MyDomainFact = RuntimeFact<MyPayload>`, etc.), delete those aliases and re-export the concrete types from your new `src/store/<myDomain>.ts`.

### 6. Update the combiner + storage layer + subpaths

`src/ProcessStore.ts`:

```ts
const facetLayers = Layer.mergeAll(
  ProcessStoreGroupLog.layerRuntimeStorage,
  ProcessStoreQueueResource.layerRuntimeStorage,
  ProcessStoreMyDomain.layerRuntimeStorage,        // ← add yours
  ProcessStoreProcessLifecycle.layerRuntimeStorage,
);

export const layerRuntimeStorage: Layer.Layer<
  | ProcessStore
  | ProcessStoreGroupLog
  | ProcessStoreQueueResource
  | ProcessStoreMyDomain                            // ← add yours
  | ProcessStoreProcessLifecycle,
  never,
  RuntimeStorage
> = /* … */;
```

`src/storage/sqlite/index.ts` — add `ProcessStoreMyDomain` to the `layerProcessStore` return-type union.

`src/index.ts`:

```ts
export { ProcessStoreMyDomain } from "./store/myDomain";
export type {
  MyDomainFact,
  MyDomainFactQuery,
  /* … your concrete types … */
} from "./store/myDomain";
```

`package.json`:

```json
"./store/MyDomain": {
  "types": "./dist/store/MyDomain.d.ts",
  "import": "./dist/store/MyDomain.mjs",
  "require": "./dist/store/MyDomain.js"
},
```

`tsup.config.ts`:

```ts
"store/MyDomain": "src/store/myDomain.ts",
```

### 7. Delete the legacy surface

This is the part that gets skipped. Do not skip it.

- Delete the old facet file (e.g. `src/ProcessStoreMyDomain.ts` if it lived at the root, or `src/store/myThing.ts` if it was the generic version).
- Delete domain-aliased re-exports of the generic envelope.
- Delete any "provide a fake service" recipe in the module doc — replace it with a paragraph pointing at `ProcessStoreMyDomain.Type` for typed mocks.
- Delete legacy `ProcessStore.<myDomain>.*` query namespaces if your part inherited any.
- Audit `docs/STORAGE.md`, `docs/STORAGE-AGENT-HANDBOOK.md`, `docs/CODEBASE-INVENTORY.md`, `docs/PROCESS-API.md`, and any `docs/plans/*.md` in scope for stale references to the legacy facet / generic envelope. The maintainer expects these updated as part of your part, not as a follow-up.

### 8. Tests

Add a conformance suite at `test/process-store-<my-domain>-facet.test.ts`. Use `test/process-store-run-resource-facet.test.ts` as the template. Cover:

1. **No-op vs persist** — `Facet.recordX(fact)` succeeds without the layer; with the layer it shows up in `facts()`.
2. **Failure isolation** — a layer whose `recordX` returns `Effect.fail(...)` still lets the caller succeed; assert the warning log line `"<service-id> write failed for recordX"`.
3. **Projections** — `latestState`, paired-run-style helpers, `byEntity`, etc. — assert real outputs from real fixtures.
4. **Phantom types** — a compile-time check that `Facet.Type` and `Facet.EmitType` resolve to the expected shape (compose a typed mock and assert at runtime that the writers are functions).

**Determinism rule.** If your facet emits multiple events that may share an `occurredAt`, do **not** assert exact relative order — sort before comparing or assert presence. The spine's `byTimestampDesc` tiebreaker is event-id-alphabetical-DESC, which collapses to whatever id naming you chose (often surprising). The flake is fundamental at the ms boundary; the fix is at the test, not the spine.

### 9. Verify

Run the handbook's verification commands. Add a 10× test loop until you're confident the suite is deterministic:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
for i in 1 2 3 4 5 6 7 8 9 10; do echo "Run $i"; pnpm test 2>&1 | tail -3 | grep Tests; done
```

### 10. Changeset + report

- Update or create a changeset under `.changeset/` describing the rename, the deleted legacy surface, the new wire event types (breaking), and the new projections.
- Report back per the handbook's "Changes made / Proposed storage API" template. Do **not** open a PR. Do **not** commit unless explicitly asked.

---

## Anti-patterns (catch yourself doing these)

| Anti-pattern | Why it is wrong | What to do |
|---|---|---|
| `MyDomainFact = RuntimeFact<MyPayload>` | Leaks generic envelope into public API; defeats per-domain rule. | Write a concrete `*Fact` interface (or discriminated union). |
| `ref: { kind: "my-domain", id }` in public types | Same — the `kind` discriminator is a generic-envelope smell. | Flat `entityId: string` (or whatever your domain calls it). |
| Hand-rolling `Effect.serviceOption(FacetTag)` in the feature module to make storage optional. | Duplicates the builder's static emitter logic. | Use `FacetTag.recordX(fact)` — already silent + isolated. |
| A new `ProcessStore.<myDomain>.*` namespace on the combiner. | Re-grows the monolith. | Apps `yield* MyFacet` then call methods. |
| Asserting `[fact-a, fact-b]` exact order when `fact-a` and `fact-b` may share `occurredAt`. | Spine tiebreaker is id-alphabetical-DESC — surprising for some id schemes. | Sort the actual array or assert `expect.arrayContaining([...])`. |
| Importing from `repos/effect/`. | Vendored read-only mirror. | Import from the package's `effect` dependency normally. |
| Marking a facet `@deprecated` with a redirect. | Handbook bans backward compat. | Delete the file. |
| Editing another part's files to "fix" a contradiction you noticed. | Out of scope; muddles the part boundaries. | Note it in your report so the maintainer can route it. |

---

## When the builder is not enough

The current `ProcessStoreBuilder.Service` covers facets whose `record` + `read` blocks each take **only a `ProcessStoreSpine`**. If your facet needs additional shared state per layer instantiation — e.g., an in-process `PubSub` to power a `live(): Stream<...>` projection — the builder does not (yet) support a shared context block between record and read.

**Two options:**

1. **Defer the streaming projection** — ship `runs()` / `byEntity()` / `latestState()` first; document `live()` as a planned follow-up. This is what `ProcessStoreRunResource` did in the rename PR.
2. **Hand-roll the facet** — use `Context.Service<Self, Shape>()(...)` with a `make` effect that builds spine + PubSub + record + read inline. You lose the auto-generated static optional emitters; you can re-create them with a small helper modelled on `wrapEmitForFacet` in `src/internal/store/service.ts`. Document in TSDoc **why** you bypassed the builder so the next agent does not "fix" it.

Either way, file a follow-up note in the changeset so the gap is visible.

---

## Glossary

- **Facet** — a per-domain storage `Context.Service` (queue, log, RunResource, processLifecycle, …). One facet per domain. Lives in `src/store/`. Exported via `@nikscripts/effect-pm/store/<Domain>`.
- **Spine** — internal record-level encode/decode/query plumbing in `src/internal/store/spine.ts` + `codec.ts`. Apps never touch this directly.
- **Static optional emitter** — class-level method (e.g. `ProcessStoreRunResource.recordRunStarted(fact)`) synthesised by `ProcessStoreBuilder.Service` from the `record` block. No-op when the facet layer is absent, persists when present, wrapped with `catchCause + logWarning` for failure isolation.
- **`Type` / `EmitType` phantom statics** — declaration-merged on each facet via `declare namespace`. Use them to type custom mocks (`const mock: MyFacet.Type = {...}`).
- **`RuntimeFact` / `RuntimeRef` / etc.** — **internal only**, retained in `src/internal/store/factEnvelope.ts` for facets that have not yet been per-domain'd (currently `ProcessStoreQueueResource`'s wire format). Not part of the public API. Do not import.
- **Generic envelope** — the `runtime.fact.recorded` / `runtime.state.changed` wire events that wrap a `FactEnvelope`. Internal. New facets must own their own event types and not use this envelope.

---

## Quick links

- Reference facet: `src/store/runResource.ts` + `test/process-store-run-resource-facet.test.ts`.
- Builder internals: `src/internal/store/service.ts` (`defineProcessStoreService` + phantom statics).
- Spine + codec: `src/internal/store/spine.ts`, `src/internal/store/codec.ts`.
- Wire event types: `src/ProcessStoreEvent.ts`.
- Master handbook: [`STORAGE-AGENT-HANDBOOK.md`](./STORAGE-AGENT-HANDBOOK.md).
