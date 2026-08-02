# Decisions — `Versioned` schema migrations (cross-version handoff)

**Status:** Design locked for owner review — **not Eng'd**. Replaces vague #35 “ranges” with a concrete Schema upcaster chain.  
**Mission:** [`node-handoff-mission.md`](./node-handoff-mission.md) (zero-downtime + cross-version skew as normal).  
**Brief:** [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md) (#35 deferred → this bake).  
**Opened:** 2026-07-30 (Agent 5 + owner chat).

---

## Goal

Contracts are Schemas. Cross-version migration is a **contiguous chain of schema transforms** from an origin shape to the current shape. App code always speaks **current**. Transforms run **automatically on codec seams** — never as an app-level `upgrade()` call in the happy path.

```text
origin ──migrate──► … ──migrate──► current
         (typed tip; gap = compile error)
```

---

## Canonical authoring (read this first)

```ts
import * as Versioned from "hyperlink-ts/Versioned"
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Node from "hyperlink-ts/Node"
import { Effect, Schema, SchemaTransformation } from "effect"

// --- historical shapes (keep in source; never delete a step you still need to read) ---
const JobV1 = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
})
const JobV2 = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
  priority: Schema.Number,
})
const JobV3 = Schema.Struct({
  id: Schema.String,
  body: Schema.Struct({
    note: Schema.String,
    priority: Schema.Number,
  }),
})

const toV2 = SchemaTransformation.transform({
  decode: (j: typeof JobV1.Type): typeof JobV2.Type => ({
    ...j,
    priority: 0,
  }),
  encode: ({ priority: _p, ...j }: typeof JobV2.Type): typeof JobV1.Type => j,
})

const toV3 = SchemaTransformation.transform({
  decode: (j: typeof JobV2.Type): typeof JobV3.Type => ({
    id: j.id,
    body: { note: j.note, priority: j.priority },
  }),
  encode: (j: typeof JobV3.Type): typeof JobV2.Type => ({
    id: j.id,
    note: j.body.note,
    priority: j.body.priority,
  }),
})

// One value: Schema for current + executable chain (branded)
const Job = Versioned.make(JobV1)
  .migrate(JobV2, toV2)
  .migrate(JobV3, toV3)
// typeof Job.Type === JobV3
// Versioned.isVersioned(Job) === true

class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job, // same slot as a plain Schema — no versions: param
}) {}

// App always speaks current — no Versioned.upgrade in user code
const program = Effect.gen(function* () {
  const jobs = yield* Jobs
  yield* jobs.add({
    id: "1",
    body: { note: "hi", priority: 2 },
  })
})
```

Optional stable label (Eng default = tip AST content-hash if omitted):

```ts
const Job = Versioned.make(JobV1)
  .migrate(JobV2, toV2)
  .migrate(JobV3, toV3)
  .id("jobs/payload@3") // schemaVersion on the wire
```

---

## Locked

### 1. Module = own namespace `hyperlink-ts/Versioned`

- Public: `src/Versioned.ts` (flat Effect-true exports) + `src/internal/versioned.ts`.
- Barrel: `export * as Versioned from "./Versioned"`.
- `package.json` exports subpath `./Versioned`.

```ts
import * as Versioned from "hyperlink-ts/Versioned"

// Public surface (sketch)
Versioned.make
// .migrate / .id on the builder
Versioned.isVersioned
Versioned.schemaVersion // (v: VersionedSchema) => string
// @internal for tests only — not app happy path:
// Versioned.unsafeComposePath(from, to)
```

- **Rejected:** `Hyperlink.Versioned` object bag; `*Contract` / `*Migration` orphan files; annotation-only module.

### 2. Carrier = Versioned schema value (same Tag slot — no extra params)

```ts
// ✅ one slot
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job,
}) {}

// ✅ plain Schema still fine (no chain → today's contractHash-only behavior)
class Legacy extends WorkPool.Tag<Legacy>()("app/Legacy", {
  payload: Schema.Struct({ id: Schema.String }),
}) {}

// ❌ rejected — no parallel param
class Bad extends WorkPool.Tag<Bad>()("app/Bad", {
  payload: JobV3,
  versions: Job, // not a Tag field
}) {}
```

### 3. Builder typing = contiguous tip (compile error on gaps / wrong order)

```ts
declare namespace Versioned {
  export interface VersionedSchema<
    Current extends Schema.Top,
    Origin extends Schema.Top,
  > {
    readonly current: Current
    readonly origin: Origin
    migrate<Next extends Schema.Top>(
      next: Next,
      step: SchemaTransformation.Transformation<
        Schema.Schema.Type<Next>,
        Schema.Schema.Type<Current>
      >,
    ): VersionedSchema<Next, Origin>
    id(label: string): VersionedSchema<Current, Origin>
  }
}

export const make: <S extends Schema.Top>(origin: S) => VersionedSchema<S, S>
```

**Type-level rejects** (ship as `versioned.test-d.ts`):

```ts
import type { SchemaTransformation } from "effect"

declare const toV2: SchemaTransformation.Transformation<
  typeof JobV2.Type,
  typeof JobV1.Type
>
declare const toV3: SchemaTransformation.Transformation<
  typeof JobV3.Type,
  typeof JobV2.Type
>
declare const skipToV3: SchemaTransformation.Transformation<
  typeof JobV3.Type,
  typeof JobV1.Type
>

const ok = Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV3)

// @ts-expect-error — tip is V1; toV3 expects V2→V3
Versioned.make(JobV1).migrate(JobV3, toV3)

// @ts-expect-error — skipping the typed tip (no V2 in chain)
Versioned.make(JobV1).migrate(JobV3, skipToV3)

// @ts-expect-error — wrong step for tip V2
Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV2)
```

### 4. Metadata home = wrapper / symbol — not Schema.annotate alone

```ts
// Load-bearing (executable steps) — brand / symbol on the schema value
Versioned.isVersioned(Job) // true
Versioned.isVersioned(JobV3) // false

// Annotate is fine for docs only — not where transforms live
Job.pipe(
  Schema.annotate({ title: "Jobs payload", description: "v3 nested body" }),
)
```

### 5. App surface = always current; transforms are automatic

```ts
// Client and server — identical call sites; both import Jobs
const use = Effect.gen(function* () {
  const jobs = yield* Jobs
  // Argument type is JobV3 — never JobV1 / JobV2
  yield* jobs.add({
    id: "1",
    body: { note: "hi", priority: 2 },
  })
  const snap = yield* jobs.status.get
  return snap
})

// ❌ not the product API
// yield* Versioned.upgrade(Job, wireBytes)
```

### 6. Version identity on the wire

```ts
// Node status / readiness service row (sketch next to today's contractHash)
type ServiceReadiness = {
  readonly key: string
  readonly kind: string
  readonly ready: boolean
  readonly contractHash: string
  /** Present when a Versioned leaf is on the Spec (v1: WorkPool payload). */
  readonly schemaVersion?: string
}

// After serve — tip advertised automatically
const row = {
  key: Jobs.key,
  kind: "hyperlink-ts/WorkPool",
  ready: true,
  contractHash: Hyperlink.contractHash(Jobs),
  schemaVersion: Versioned.schemaVersion(Job), // "jobs/payload@3" or AST hash
}
```

| Signal | Meaning |
|--------|---------|
| `schemaVersion` | Tip id for that Versioned leaf |
| `contractHash` | F4 fingerprint of the **current whole Spec** |

### 7. Who applies (direction)

```text
Local tip vs peer.schemaVersion
  equal     → passthrough
  peer older → upcast inbound to current; downcast outbound to peer
  peer newer → upcast what we still understand; else MigrationPathMissing
  no path   → MigrationPathMissing (loud)
```

Receiving current side preferred at handoff (A need not know B’s newer Schema).

### 8. Seams that auto-apply — examples

#### 8a. Client ahead of an outdated server

```ts
// Process B (tip v3) dials Process A (still advertising schemaVersion for v1)
const layer = Hyperlink.client(Jobs, WorkerA).pipe(
  Layer.provide(transport),
)

const program = Effect.gen(function* () {
  const jobs = yield* Jobs
  // You write v3. Seam downcasts request to v1 for A, upcasts A's v1 response to v3.
  yield* jobs.add({
    id: "1",
    body: { note: "hi", priority: 2 },
  })
}).pipe(Effect.provide(layer))
```

#### 8b. Server ahead of an outdated client

```ts
// Server tip v3; old dashboard still speaks v2 on the wire
Node.unix(Worker, [
  WorkPool.serve(Jobs, {
    effect: (job) =>
      Effect.gen(function* () {
        // Handler already sees JobV3 — seam upcasted the v2 request
        yield* Effect.logInfo(job.body.note)
      }),
  }),
])
// Responses downcast to client's schemaVersion when needed
```

#### 8c. Handoff A→B (WorkPool bake — no app upgrade call)

```ts
// A runs Job at v2 tip; B runs same Tag at v3 tip (same source Tag after deploy skew window)
// WorkPool.serve always bakes releaseEnqueueHandoff (#39)

// B visible first, then:
yield* Node.shutdown(WorkerA)
// Inside bake (sketch):
//   const raw = yield* from.release({})          // A's native / encoded @ v2
//   // B's enqueue decode sees schemaVersion=v2 + Versioned Job @ v3
//   // → auto upcast → JobV3 → enqueue
```

Custom `{ handoff }` unchanged — codecs still auto-apply:

```ts
Hyperlink.serve(
  Mover,
  impl,
  {
    handoff: (from, to, ctx) =>
      Effect.gen(function* () {
        const items = yield* from.take // already current on this node
        yield* to.give(items) // peer decode upcasts if peer tip newer
        return yield* ctx.done
      }),
  },
)
```

#### 8d. Durable store reopen

```ts
// Rows written last month as JobV1 JSON + schemaVersion
// Process boots with Job tip v3 + Soft/durable store
WorkPool.layer(Jobs, { effect: handle }).pipe(
  Layer.provide(AppStore.layer),
)
// On load: decode path sees stored schemaVersion → auto upcast to JobV3
// App handlers never see JobV1
```

### 9. Errors (tagged only)

```ts
import { Exit, Effect } from "effect"

class MigrationPathMissing extends Schema.TaggedErrorClass<MigrationPathMissing>()(
  "MigrationPathMissing",
  {
    serviceKey: Schema.String,
    leaf: Schema.String, // e.g. "payload"
    from: Schema.String,
    to: Schema.String,
  },
) {}

class MigrationDecodeFailed extends Schema.TaggedErrorClass<MigrationDecodeFailed>()(
  "MigrationDecodeFailed",
  {
    serviceKey: Schema.String,
    leaf: Schema.String,
    from: Schema.String,
    step: Schema.String,
  },
) {}

// Call site — match _tag, never message strings
const exit = yield* Effect.exit(Node.shutdown(WorkerA))
if (Exit.isFailure(exit)) {
  // … Cause.failure or fail matching MigrationPathMissing / HandoffDeferred
}
```

- `ContractMismatch` remains for whole-Spec / non-Versioned drift.
- Path missing is **not** softened by `Policy.verifyOff`.

### 10. Tag owns the chain; Handle stays current API

```ts
// Both processes import the same Tag module — chain travels with the Tag
import { Jobs } from "./jobs"

const jobs = yield* Jobs
// jobs.add : (payload: JobV3) => …
// no jobs.versions / jobs.migrate on the Handle
```

### 11. Grain / rollout

```ts
// v1 — WorkPool payload only
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Job }) {}

// later — same pattern on any Schema leaf
class Counter extends Hyperlink.Tag<Counter>()("app/Counter", {
  value: Versioned.make(Schema.Number).migrate(Schema.Number, bump),
}) {}
```

### 12. Relation to existing tracks

| Track piece | Interaction |
|-------------|-------------|
| `#39` serve `{ handoff }` | API unchanged; codecs auto-apply Versioned |
| WorkPool `releaseEnqueueHandoff` | Auto upcast on peer enqueue decode |
| `#35` ranges | **Superseded** by this bake |
| `contractHash` / verify | Kept; + `schemaVersion` when leaf is Versioned |
| Policy / `lookupClient` | Dial unchanged; decode layer applies Versioned |

---

## End-to-end skew story (one narrative)

```ts
// shared/jobs.ts — both A and B import this after B's deploy
export const Job = Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV3)
export class Jobs extends WorkPool.Tag<Jobs>()("fleet/Jobs", { payload: Job }) {}

// --- Node A (old binary still on tip v2 in an earlier release) ---
// Advertises schemaVersion for JobV2; pending queue holds v2 rows

// --- Node B (new binary, tip v3) ---
Node.unix(WorkerB, [
  WorkPool.serve(Jobs, { effect: handleV3, autoStart: false }),
]).pipe(Layer.provide(Lookup.client(lookupNode)))

// Dialers on tip v3
Hyperlink.lookupClient(Jobs).pipe(
  Policy.provide(Policy.sticky),
  Layer.provide(Lookup.layer),
)

// Cutover
yield* Advice.prefer(Jobs, WorkerB.key)
yield* Node.shutdown(WorkerA)
// release @ v2 → B enqueue decode → JobV3 automatically
// lookupClient already on B; app still adds JobV3 only
```

---

## Rejected (record)

- App-facing `upgrade` / `downgrade` on the happy path  
- Extra Tag params (`versions`, `migrations`)  
- Annotation-only storage of transform functions  
- Handle-carried version maps  
- Silent passthrough when path missing  
- Replacing F4 `contractHash`  
- `HandoffManager` / parallel migration control plane  
- Eng before owner go on this file  

---

## Eng gate (when owner says go)

1. `Versioned` module + typed builder + brand + `isVersioned` + `.id`  
2. Wire `schemaVersion` on status service row for Versioned WorkPool payload  
3. Client + serve codec hooks  
4. Handoff / `releaseEnqueueHandoff` + durable reopen hooks  
5. Tagged errors + `versioned.test-d.ts` contiguous-chain asserts  
6. Guide + runnable example (old peer and/or store reopen)  
7. Changeset (minor)  
8. Brief #35 → “superseded by Versioned” (already pointed here)

**Out of Eng v1:** non-payload leaves; `restartSuccessor`; Directory column (use status row).

---

## Open at Eng only (not product forks)

- Exact `schemaVersion` mint — recommend **AST content hash of tip** + optional `.id("…")` override.  
- Status `services[].schemaVersion` vs Directory column — prefer **status row** next to `contractHash`.
