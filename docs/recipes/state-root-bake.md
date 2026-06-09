# State.Root + snapshot model — bake

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Goal:** Lock how live scope state, telemetry extend fields, and `State.Changed` wire snapshots relate — so implementer can ship `State.Root` and delete scratch/`pending*` patterns.  
**SSoT after bake:** [telemetry-requirements.md](./telemetry-requirements.md) + [state-root-telemetry-resume-handoff.md](../handoffs/state-root-telemetry-resume-handoff.md)

**Non-goals:** Implement `State.ts`; kernel migration; wiring runtime.

---

## Locked ingredients (prior sessions)

- **`State.Root`** — auto envelope per domain scope instance; authors never declare it.
- Envelope top level: optional spread from domain tag **`static Root`** (plain JSON, optional, manual per domain).
- **`previous: null | CurrentShape`**, **`current: CurrentShape`** — transition machinery owns `previous`; authors write `current`.
- **`yield* RunResourceScope`** / leaf scopes — process view (unchanged author ergonomics).
- **`yield* State.Root`** — full envelope; **internal only** (`internal/telemetry`, transition emit).
- **No auto `metadata` field** — only keys authors put in `static Root`.
- **`RootMetadata` type** — JSON-safe; forbids `previous` / `current` keys on static object.
- Reject **`pending*`** scratch fields on extend / telemetry state.
- **`Telemetry.extend(scope, fields)`** — hidden counters/gauges on **same storage object** as scope; process types exclude them (plan 21).
- **`RunResourceState.ts`** — interim debt; owner reopened D5.

### Locked — step 1 (Jun 2026)

- **`root.current` is nested** — author scope tree + extend siblings at the scope level they register on.
- **Extend fields are siblings** on the extended scope inside `current` (not a side Ref, not a `telemetry:` bucket).
- **Process yield is filtered** — `yield* RunResourceScope` sees author fields only; `yield* State.Root` sees full `current`.
- **`concurrency` is an author scope field** on `RunResourceScope` (root of `current`), set at layer init — not extend, not wire-only.
- Wire flat snapshot is **step 3** — do not flatten live `current` for archive convenience.

```ts
type CurrentShape = {
  resourceId: string;
  concurrency: number;            // author — RunResourceScope
  waiting: number;                  // extend @ RunResourceScope
  inFlight: number;
  completed: number;
  failed: number;
  interrupted: number;
  totalDurationMs: number;
  configVersion: number;
  Run?: { runId: string };          // withLeaf — during op
};
```

### Locked — step 2 (Jun 2026)

- **One `Ref<Envelope>` per domain scope instance** — owned by `State.Root` layer (created when root scope `layer()` runs).
- **Envelope shape:** `{ …staticRoot spread, previous: CurrentShape | null, current: CurrentShape }`.
- **Every state transition** (internal only): inside **one `Ref.modify`**, set `previous = structuredClone(current)`, then `current = update(structuredClone(current))`, then emit `State.Changed`.
- **Scopes are read-only views** of `envelope.current` — only `State.transition` (internal) writes the Ref.
- **First transition:** `previous === null` until first modify; after that each transition overwrites `previous` with one-step-back snapshot (not a history stack).
- **`State.previous(scope)` helper** — symmetric to `yield* scope` for **current**; returns **process-filtered slice** of `envelope.previous` for any scope tag, or `null` when `envelope.previous === null` or slice absent (e.g. `Run` nest missing in previous tree).

```ts
// Current (existing plan)
const now = yield* RunResourceScope;
const run = yield* RunScope;

// Previous slice — same filter rules as yield* scope
const was = yield* State.previous(RunResourceScope);
// { resourceId: string; concurrency: number } | null

const wasRun = yield* State.previous(RunScope);
// { runId: string } | null

// Full envelope — internal only (materializer, transition)
const root = yield* State.Root;
root.previous; // full CurrentShape | null
root.current;
```

| API | Reads | Filter | Who |
| --- | --- | --- | --- |
| `yield* RunResourceScope` | `current` | process (no extend) | kernel / process |
| `yield* RunScope` | `current` | leaf slice | op runner |
| **`yield* State.previous(Scope)`** | **`previous`** | **same as paired scope** | kernel / process |
| `yield* State.Root` | `previous` + `current` | none (full tree) | `internal/telemetry` only |

**v1:** no `State.previous` overload for extend fields — internal code uses `State.Root.previous` when counters needed.

---

## Open recipe steps

1. ~~**`State.Root.current` live shape**~~ — **locked**
2. ~~**`previous` transition model + `State.previous(scope)`**~~ — **locked**
3. ~~Wire **`previous` / `current`**~~ — **locked** (nested, same as live)
4. ~~**Store / archive**~~ — inventory locked; implementation follows nested schema (no SQLite change)
5. ~~**Event vs snapshot fields**~~ — **locked**
6. ~~**`State.Changed` materialize / bind**~~ — **locked**
7. ~~**Snapshot schema module (D5)**~~ — **locked** — see § Canonical schemas

**Bake complete (snapshot model)** — implementer handoff: [state-root-telemetry-resume-handoff.md](../handoffs/state-root-telemetry-resume-handoff.md) + § One-pass migration checklist below.

### Cross-track lock (impl agent — Step 4)

**`EventNode` yield mechanism** — prefer **`Effectable.Prototype`** (Effect v4 `Config` / `Statement` pattern) in [telemetry-requirements.md](./telemetry-requirements.md) Step 4. Staged `makeEventNode` may still use `Object.assign(Effect.sync(noop), meta)` — migrate to Prototype; Step 6 swaps `evaluate`, not the handle shape.

---

## Open recipe steps (continued)

8. **Auto-materialize field markers + log-only wiring** *(paused — see EventNode lock below)* — `State.Changed` has no bind map
9. **`State.transition` + `State.Root` service API** — pending
10. **Leaf nest lifecycle (`Run` in `current`)** — pending

---

## Canonical schemas (D5 — locked Jun 2026)

**Module:** `src/store/RunResourceState.ts` (path kept; **rename exports** — no flat shim).

**Snapshot** — nested `CurrentShape`; shared by live envelope, wire, archive JSON, store queries, projection.

```ts
/** Nested gate snapshot — matches `State.Root` `current` / `previous` trees. @public */
export const RunResourceSnapshotSchema = Schema.Struct({
  resourceId: Schema.String,
  concurrency: Schema.Number,
  waiting: Schema.Number,
  inFlight: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  interrupted: Schema.Number,
  totalDurationMs: Schema.Number,
  configVersion: Schema.Number,
  Run: Schema.optional(Schema.Struct({ runId: Schema.String })),
});

export type RunResourceSnapshot = typeof RunResourceSnapshotSchema.Type;
```

**Delete** flat `RunResourceStateSchema` and **`observedAt` inside snapshot** — timestamp lives on the **event** as `changedAt`.

**Scope declaration** (author) — add `concurrency` to root scope:

```ts
class RunResourceScope extends State.Scope(RunResource)({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}
```

**`State.Changed` event** — event fields vs snapshot fields:

```ts
class RunResourceStateChanged extends Telemetry.Schema<RunResourceStateChanged>()(
  RunResourceScope,
)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
  reason: Schema.Literals(STATE_CHANGE_REASONS),
  previous: Schema.NullOr(RunResourceSnapshotSchema),
  current: RunResourceSnapshotSchema,
}) {}
```

| Field | Layer | Source at materialize |
| --- | --- | --- |
| `changedAt` | **event** | `Telemetry.terminal.clockMillis` |
| `id` | **event** | **Auto** — transition frame (monotonic seq / string id minted in `State.transition`) |
| `reason` | **event** | **Auto** — `State.transition(reason, …)` argument |
| `previous` | **snapshot** | **Auto** — `State.Root.previous` |
| `current` | **snapshot** | **Auto** — `State.Root.current` |

**`State.Changed` wiring v1:** **no `Telemetry.bind` fields** — optional `.pipe(log…)` only. All payload fields materialize from transition frame + envelope.

**Reject:** `pendingPreviousSnapshot`, `pendingCurrentSnapshot`, `pendingReasonWire`, `observedAt` in snapshot, bind entries for `previous`/`current`/`reason`/`id`.

**Wiring (API 3):**

```ts
// Optional log legs only — no bind map (PlainFields = never for this handle)
Telemetry.bind(RunResourceTelemetry.State.Changed, {}).pipe(
  Telemetry.logWarning("RunResourceStore write failed for state change", …),
)
// Or: dedicated log-only wiring helper if empty bind is awkward — implementer choice
```

---

## Recipe step 5 — event vs snapshot fields

**Locked** — see § Canonical schemas table. Drop `observedAt` from snapshot; use `changedAt` on event only.

---

## Recipe step 6 — `State.Changed` materialize

**Locked:**

- **All `State.Changed` fields auto-materialize** — transition frame (`id`, `reason`) + envelope (`previous`, `current`) + terminal (`changedAt`). **No bind map**; optional log `.pipe` only.
- Extend counters remain on scope for metrics legs — **not** for stuffing event payload via bind.

---

## Recipe step 7 — migration names

**Locked:**

| Old | New |
| --- | --- |
| `RunResourceStateSchema` | `RunResourceSnapshotSchema` |
| `RunResourceState` (type) | `RunResourceSnapshot` |
| `RunResourceStateChange` | keep name; update `previous`/`current` types to `RunResourceSnapshot` |
| Flat decode helpers | `Schema.decodeUnknownOption(RunResourceSnapshotSchema)` |

**No** re-export alias of old flat names (repo rule: no legacy shims).

### One-pass migration checklist (implementer)

1. **`RunResourceState.ts`** — replace with nested `RunResourceSnapshotSchema`; update module doc.
2. **`RunResourceScope.ts`** — add `concurrency: Schema.Number`.
3. **`RunResourceTelemetry.ts`** — Tag + hub input schemas; wiring example in requirements.
4. **`RunResourceStore.ts`** — decode + `RunResourceStateOutputSchema` → nested; delete `decodeStateValueOption` hand-roll.
5. **`RunResourceProjection.ts`** — `RunResourceSnapshot` in HashMap.
6. **`kernel.ts`** — deferred until `State.Root` + Step 8; until then emit nested shape from transition stub if touching store first.
7. **`telemetry-requirements.md`** — already updated via this bake.
8. **Tests** — archive round-trip with `Run: { runId }` present/absent.

**SQLite:** no DDL change (`payload_json` already JSON).


---

## Recipe step 1 — `State.Root.current` live shape

**Locked** — see § Locked — step 1.

---

## Recipe step 2 — `previous` transition model

**Locked** — see § Locked — step 2.

---

## Recipe step 3 — wire `previous` / `current` shape

**Locked (Jun 2026):**

- **Wire uses the same nested shape as live `CurrentShape`** — no flatten-at-emit projection for telemetry.
- **`State.Changed` `previous` / `current`** payloads mirror `envelope.previous` / `envelope.current` (full nested tree including optional `Run` nest and extend siblings).
- **Do not** let legacy flat `RunResourceStateSchema` or archive row layout dictate wire shape.
- **Telemetry RPC** — not built yet; **out of scope** for this decision (shape when RPC lands should match wire, nested).
- **Store / archive** — must learn to persist nested snapshot payloads; **separate implementation track** with its own bake/handoff — not a reason to flatten telemetry wire.

```ts
// Wire snapshot schema — nested (matches CurrentShape)
const RunResourceSnapshotSchema = Schema.Struct({
  resourceId: Schema.String,
  concurrency: Schema.Number,
  waiting: Schema.Number,
  inFlight: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  interrupted: Schema.Number,
  totalDurationMs: Schema.Number,
  configVersion: Schema.Number,
  Run: Schema.optional(Schema.Struct({ runId: Schema.String })),
});

class RunResourceStateChanged extends Telemetry.Schema<RunResourceStateChanged>()(
  RunResourceScope,
)({
  id: Schema.String,
  changedAt: Telemetry.terminal.clockMillis,
  reason: Schema.Literals(STATE_CHANGE_REASONS),
  previous: Schema.NullOr(RunResourceSnapshotSchema),
  current: RunResourceSnapshotSchema,
}) {}
```

**Superseded:** flat `RunResourceStateSchema` — see [state-root-bake.md](./state-root-bake.md) § Canonical schemas.

**Interim:** replace flat `RunResourceStateSchema` in `RunResourceState.ts` with nested `RunResourceSnapshotSchema` in one migration pass — delete flat struct, update store/projection/telemetry imports. No flat shims.

**Out of scope here:** SQLite/Prisma archive column strategy, RPC codec, projection query ergonomics for nested paths.

---

## Recipe step 4 — store / archive nested payloads

**Finding (Jun 2026 recon):** **SQLite/archive does NOT flatten.** `RuntimeRecord.payload` is opaque JSON (`payload_json TEXT`). Nested objects persist fine. Flattening is **schema + kernel + manual decode** — see § Legacy flatten inventory below.

*Deferred implementation — but inventory locked so migration is one pass, not drift.*

### Legacy flatten inventory

| Layer | File | What happens | Nested-ready? |
| --- | --- | --- | --- |
| **Schema (source of flat shape)** | `src/store/RunResourceState.ts` | Defines flat `RunResourceStateSchema` (11 scalar fields, no `Run` nest) | ❌ **Root cause** |
| **Telemetry wire + hub debt** | `src/store/RunResourceTelemetry.ts` | `StateChanged` input + Tag schema import flat schema for `previous`/`current` | ❌ |
| **Kernel (author flat state)** | `src/internal/runResource/kernel.ts` | `Ref<RunResourceState>`, `makeInitialState`, `publishState` builds/emits flat blobs | ❌ |
| **Archive encode** | `src/store/RunResourceStore.ts` `encodeStateChangedRecord` | Passes `previous`/`current` **through** into JSON payload — **no flatten** | ✅ already |
| **Archive decode** | `src/store/RunResourceStore.ts` `decodeStateValueOption` | Hand-rolls **flat** field extraction; nested keys ignored / decode fails | ❌ |
| **Store query API** | `src/store/RunResourceStore.ts` `RunResourceStateOutputSchema` | Duplicates flat struct for `latestState` / `stateHistory` RPC | ❌ |
| **Projection** | `src/RunResourceProjection.ts` | `HashMap<string, RunResourceState>` — flat type | ❌ |
| **Storage adapter** | `src/storage/sqlite/codec.ts` | JSON encode/decode arbitrary `JsonValue` | ✅ |
| **Runtime row model** | `src/RuntimeStorage.ts` `RuntimeRecord.payload` | Opaque JSON blob | ✅ |

**No Telemetry RPC** exists yet — nothing to migrate there.

**Contradiction in current docs/code:** `RunResourceState.ts` header says extend fields are *not* in the snapshot, but the schema **includes** `waiting`, `inFlight`, etc. (extend counters). Bake target: nested `CurrentShape` with extend siblings + optional `Run` nest; drop `observedAt` from snapshot (event field).

### One-pass migration checklist

See § **One-pass migration checklist (implementer)** under Recipe step 7 (canonical list).

---

## Legacy flatten inventory (detail)

### Encode path — already nested-capable

```279:292:src/store/RunResourceStore.ts
const encodeStateChangedRecord = (
  input: RunResourceStateChangedInput,
): Omit<RuntimeRecord, "runId" | "createdAt"> => ({
  // ...
  payload: {
    id: input.id,
    reason: input.reason,
    previous: input.previous,   // stored as-is into JSON
    current: input.current,
  },
});
```

### Decode path — where flat is enforced

```310:326:src/store/RunResourceStore.ts
const decodeStateValueOption = (value: unknown): Option.Option<RunResourceState> =>
  recordValue(value).pipe(
    Option.flatMap((state) =>
      Option.all({
        resourceId: stringValue(state["resourceId"]),
        observedAt: numberValue(state["observedAt"]),
        // … only flat keys — no Run?, nested decode
      }),
    ),
  );
```

### Kernel — flat state authored here (not store)

```129:173:src/internal/runResource/kernel.ts
const makeInitialState = (observedAt: number): RunResourceState => ({
  resourceId,
  observedAt,
  configVersion: 1,
  concurrency,
  waiting: 0,
  // … flat only
});
// …
yield* RunResourceHubTelemetry.State.changed({
  previous: change.previous,
  current: change.current,
});
```

