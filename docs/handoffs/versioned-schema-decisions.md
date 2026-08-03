# Decisions — `Versioned` schema migrations (cross-version handoff)

**Status:** Design locked (owner chat 2026-08-02 / 2026-08-03) — **Versioned v1 Eng'd** 2026-08-03. Replaces vague #35 “ranges” with a concrete Schema upcaster chain.  
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

**One identity system:** `Versioned.schemaVersion(schema) → string` everywhere (status, durable rows, handoff envelopes, RPC seams). Retires `WorkPool.withSchemaVersion` / numeric annotate / integer store column as the public story.

---

## Canonical authoring (read this first)

```ts
import * as Versioned from "hyperlink-ts/Versioned"
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Effect, Schema, SchemaTransformation } from "effect"

// --- tips = Schema.Class with stable identifiers (preferred) ---
class JobV1 extends Schema.Class<JobV1>("jobs/payload@1")({
  id: Schema.String,
  note: Schema.String,
}) {}

class JobV2 extends Schema.Class<JobV2>("jobs/payload@2")({
  id: Schema.String,
  note: Schema.String,
  priority: Schema.Number,
}) {}

class JobV3 extends Schema.Class<JobV3>("jobs/payload@3")({
  id: Schema.String,
  body: Schema.Struct({
    note: Schema.String,
    priority: Schema.Number,
  }),
}) {}

const toV2 = SchemaTransformation.transform({
  decode: (j: JobV1): JobV2 => new JobV2({ ...j, priority: 0 }),
  encode: ({ priority: _p, ...j }: JobV2): JobV1 => new JobV1(j),
})

const toV3 = SchemaTransformation.transform({
  decode: (j: JobV2): JobV3 =>
    new JobV3({ id: j.id, body: { note: j.note, priority: j.priority } }),
  encode: (j: JobV3): JobV2 =>
    new JobV2({ id: j.id, note: j.body.note, priority: j.body.priority }),
})

// Chain composes transforms only — not a separately named entity
const Job = Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV3)
// typeof Job.Type === JobV3
// Versioned.schemaVersion(Job) === "jobs/payload@3"  (tip Class.identifier)
// Versioned.schemaVersion(JobV1) === "jobs/payload@1"

class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job, // same slot as a plain Schema — no versions: param
}) {}

// App always speaks current — no Versioned.upgrade in user code
const program = Effect.gen(function* () {
  const jobs = yield* Jobs
  yield* jobs.add(
    new JobV3({ id: "1", body: { note: "hi", priority: 2 } }),
  )
})
```

Plain Schema (no chain) still works — single tip, id = AST hash of that schema:

```ts
const LegacyJob = Schema.Struct({ id: Schema.String })
Versioned.schemaVersion(LegacyJob) // AST hash — no migration path if shape changes
```

---

## Locked

### 1. Module = own namespace `hyperlink-ts/Versioned`

- Public: `src/Versioned.ts` (flat Effect-true exports) + `src/internal/versioned.ts`.
- Barrel: `export * as Versioned from "./Versioned"`.
- `package.json` exports subpath `./Versioned`.

```ts
import * as Versioned from "hyperlink-ts/Versioned"

// Public surface
Versioned.make
// .migrate on the builder (no chain-level .id)
Versioned.isVersioned
Versioned.schemaVersion // (schema: Schema.Top | VersionedSchema) => string
// @internal for tests only — not app happy path:
// Versioned.unsafeComposePath(from, to)
```

- **Rejected:** `Hyperlink.Versioned` object bag; `*Contract` / `*Migration` orphan files; annotation-only module; chain-level `.id()`.

### 2. Scope = Schema leaves only (not Nodes / Tags / Specs)

| Concern | Home |
|---------|------|
| Payload / success / error / event **shapes** | `Versioned` on that Schema leaf |
| Whole RPC surface drift | `contractHash` / F4 (keep) |
| Transport / protocol | `ProtocolMismatch` |
| Membership / dial | Directory + Advice + Policy |
| Retiring a **method** from the Handle while keeping wire | Proposed: `Hyperlink.deprecated` (below) — orthogonal |

**v1 Eng grain:** WorkPool `payload` only. Later: same pattern on any Schema leaf (`success`, `error`, Daemon `event`, …). No second versioning plane for Node/Tag/deploy.

### 3. Carrier = Versioned schema value (same Tag slot — no extra params)

```ts
// ✅ one slot
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", { payload: Job }) {}

// ✅ plain Schema still fine (single tip → AST-hash schemaVersion; no upcast path)
class Legacy extends WorkPool.Tag<Legacy>()("app/Legacy", {
  payload: Schema.Struct({ id: Schema.String }),
}) {}

// ❌ rejected — no parallel param
class Bad extends WorkPool.Tag<Bad>()("app/Bad", {
  payload: JobV3,
  versions: Job,
}) {}
```

### 4. Identity = per tip schema (one system)

`Versioned.schemaVersion(x) → string` is the **only** public schema-version API.

| Tip kind | Id |
|----------|-----|
| `Schema.Class("jobs/payload@3")` (preferred) | `Class.identifier` |
| Plain `Schema` / Class without usable identifier | AST content-hash of tip (same family as `contractHash` fingerprint) |
| `Versioned` carrier | Id of **current tip** |

Wire / status / durable / handoff all stamp that same string.

**Retire:** `WorkPool.withSchemaVersion` / `schemaVersionOf` (number) / durable `schema_version INTEGER` as the public story → store column becomes **string** (legacy int rows: one-shot read rule or fail loud).

**Rejected:** labeling the Versioned chain; manual integer bumps as migration; two competing version fields.

### 5. Builder typing = contiguous tip (compile error on gaps / wrong order)

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
  }
}

export const make: <S extends Schema.Top>(origin: S) => VersionedSchema<S, S>
```

**Type-level rejects** (ship as `versioned.test-d.ts`): skip tip, wrong step for tip, gap.

### 6. Metadata home = wrapper / symbol — not Schema.annotate alone

```ts
Versioned.isVersioned(Job) // true
Versioned.isVersioned(JobV3) // false — tip alone is not the carrier
```

Executable steps live on the branded carrier. Annotate is fine for docs only.

`Schema.Class.extend` is **field inheritance**, not migration — do not treat as `migrate`.

### 7. App surface = always current; transforms are automatic

```ts
const use = Effect.gen(function* () {
  const jobs = yield* Jobs
  yield* jobs.add(new JobV3({ id: "1", body: { note: "hi", priority: 2 } }))
})
// ❌ not the product API — yield* Versioned.upgrade(Job, wireBytes)
```

### 8. Version identity on the wire

```ts
type ServiceReadiness = {
  readonly key: string
  readonly kind: string
  readonly ready: boolean
  readonly contractHash: string
  /** Tip id when a Versioned (or any Schema) leaf is present — v1: WorkPool payload. */
  readonly schemaVersion?: string
}
```

| Signal | Meaning |
|--------|---------|
| `schemaVersion` | Tip id for that Schema leaf |
| `contractHash` | F4 fingerprint of the **current whole Spec** (includes deprecated wire methods) |

Prefer **status row** next to `contractHash` — not a Directory column.

### 9. Who applies (direction)

```text
Local tip vs peer/row schemaVersion
  equal     → passthrough
  peer older → upcast inbound to current; downcast outbound to peer
  peer newer → upcast what we still understand; else MigrationPathMissing
  no path   → MigrationPathMissing (loud)
```

Receiving current side preferred at handoff (A need not know B’s newer Schema).

### 10. Seams that auto-apply

- Client ↔ server RPC codecs  
- WorkPool `releaseEnqueueHandoff` / peer `enqueue` decode  
- Custom `{ handoff }` (codecs still auto-apply)  
- Durable store reopen  

### 11. Errors (tagged only)

- `MigrationPathMissing` `{ serviceKey, leaf, from, to }`  
- `MigrationDecodeFailed` `{ serviceKey, leaf, from, step }`  
- `ContractMismatch` remains for whole-Spec / non-migratable drift  
- Path missing is **not** softened by `Policy.verifyOff`

### 12. Tag owns the chain; Handle stays current API

Both processes import the same Tag module — chain travels with the Tag. No `jobs.versions` / `jobs.migrate` on the Handle.

### 13. Relation to existing tracks

| Track piece | Interaction |
|-------------|-------------|
| `#39` serve `{ handoff }` | API unchanged; codecs auto-apply Versioned |
| WorkPool `releaseEnqueueHandoff` | Auto upcast on peer enqueue decode |
| `#35` ranges | **Superseded** by this bake |
| `contractHash` / verify | Kept; + `schemaVersion` for leaf tip |
| Policy / `lookupClient` | Dial unchanged; decode layer applies Versioned |
| `Hyperlink.deprecated` (planned) | Orthogonal — method retirement, not payload migration; Eng **after** Versioned |

---

## Planned — `Hyperlink.deprecated` (method retirement; Eng after Versioned)

**Status:** Design direction locked 2026-08-03 — **doc only; no Eng until Versioned v1 finishes**.  
Complements Versioned: Versioned evolves a leaf **shape**; deprecated retires a **method** from the typed Handle while keeping it on the wire for skew.

### Problem

Today Spec leaves split Handle vs wire the **opposite** way:

| Leaf | Handle | Wire |
|------|--------|------|
| `Method` | yes | yes |
| `local` / `default` | yes | **no** |
| **deprecated** | **no** | **yes** (+ impl required) |

Old clients still call `rename` during a rollout; new app code must not see `rename` on `yield* Tag`.

### Shape — invert `local`, dual (prefer pipe)

New leaf brand (mirror of `LocalMethod` / `DefaultMethod`). API is **`Fn.dual`** — data-first and pipeable; **canonical authoring is piped** (cleaner next to other Method combinators).

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

class Files extends Hyperlink.Tag("app/Files")({
  move: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }),
  // Preferred — pipe
  rename: Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }).pipe(Hyperlink.deprecated),
}) {}

// Also valid (dual data-first) — same brand
const legacyRename = Hyperlink.deprecated(
  Hyperlink.effectFn({
    payload: Schema.Struct({ from: Schema.String, to: Schema.String }),
    success: Schema.Void,
  }),
)

// Serve — impl REQUIRED for deprecated (same as wire methods)
Hyperlink.serve(Files, {
  move: (p) => Effect.void,
  rename: (p) => Effect.void, // old clients still dial this RPC
})

const files = yield* Files
files.move // ✅
files.rename // ❌ not on Handle (compile error)
```

### Filter matrix (Eng target)

| Projection | `deprecated` |
|------------|--------------|
| `ServiceOf` / Handle / `buildClientService` / `buildLocalContext` | **omit** |
| `RpcUnionOf` / `buildRpcGroup` / client forwarder | **include** |
| `ServeImplOf` / server handlers | **required** |
| `contractHash` | **include** (skew window: old+new Specs still agree on wire) |

### Why this way

| Alternative | Why not |
|-------------|---------|
| Annotation-only / TSDoc `@deprecated` | Soft; still on Handle |
| Flag on `Method` without brand | Easy to miss in `ServiceOf`; brand matches `local`/`default` |
| Separate `deprecated: { … }` Tag bag | Second Spec map |
| Drop from `contractHash` immediately | Breaks old clients mid-rollout |
| Pipe-only (no dual) | Breaks house `Fn.dual` pattern (`defaults`, `withReadiness`, …) |

### Lifecycle

1. Method is normal wire+Handle.  
2. `.pipe(Hyperlink.deprecated)` — impl stays; Handle hides; wire+hash keep.  
3. After fleet past skew: **delete** the leaf → `contractHash` changes → remaining old clients fail loud.

### Relation to Versioned

- Prefer **Versioned** when the method stays and the **payload tip** moves.  
- Prefer **deprecated** when the **verb** itself is leaving the product API.  
- Can combine: deprecated method whose payload is still a Versioned leaf for the skew window.

### Deferred open (resolve at Eng, after Versioned)

- CLI/TUI: hide vs mark deprecated methods  
- Toolkit fixed Specs (WorkPool verbs) — app Tags only for first Eng slice?

---

## Planned — Launcher / Lookup update impact (dependent nodes)

**Status:** Design sketch 2026-08-03 — **doc only; no Eng / no product updates until Versioned (+ then deprecated) land**.  
Explicit A/B / `restartSuccessor` stay behind this plan.

### Problem

Bringing up B as an update of A is not only “spawn B → handoff → shutdown A”. Other nodes may:

- **Serve** the same identity / peer set (must roll in order or together).  
- **Dial** A’s services — soft if Versioned+Policy cover skew; hard if `contractHash` breaks or deprecated methods were removed too early.  
- **Hold durable state** stamped with old `schemaVersion` tips (need chain path on the receiving tip).  
- Be the **Lookup** node (#36 still deferred — special).

Launcher (spine α) stays dumb spawn→Ready→assume→exit — **update orchestration** needs an impact set before/around that.

### Impact set (sketch)

Inputs already on tip (plus Versioned / deprecated once Eng’d):

- Directory: who serves which HyperService keys / dials  
- Status rows: `contractHash`, `schemaVersion`, readiness, phase  
- Advice: prefer / sticky  
- Tag modules: Versioned chains + deprecated wire surface  

```ts
// Names TBD at Eng — prefer Node/Lookup nouns over Launcher brain
type UpdateImpact = {
  readonly target: Node.Key
  readonly successor: SpawnSpec
  readonly coUpdate: ReadonlyArray<Node.Key>
  readonly clientsAtRisk: ReadonlyArray<{ node: Node.Key; serviceKey: string }>
  readonly migrationGaps: ReadonlyArray<{
    serviceKey: string
    leaf: string
    from: string
    to: string
  }>
  readonly wireRemovals: ReadonlyArray<{ serviceKey: string; method: string }>
}

// Dry-run before spawn — fail closed if migrationGaps / unsafe wireRemovals
yield* Lookup.planUpdate(target, successorTagBundle) // name TBD
yield* Launcher.up(successor) // only after plan says safe (or owner force)
```

### Rules of thumb

1. **Payload tip move with Versioned path** → clients/peers can skew; soft warn.  
2. **`contractHash` change without deprecated bridge** → dialers are **must-update** (or accept downtime).  
3. **Method removed (not deprecated)** → same as (2) for callers of that method.  
4. **Method deprecated** → dialers can lag; servers keep impl until no old tip remains.  
5. **Durable tip without chain path** → block successor Ready / handoff.  
6. **Lookup node** → out of band (#36); not special-cased in Launcher v1.

### Where the brain lives

| Plane | Role in updates |
|-------|-----------------|
| **Lookup** | Membership + impact query |
| **Node** | drain / shutdown / handoff / status |
| **Launcher** | spawn → Ready → assume → exit for units in a **plan** |
| **Policy / lookupClient** | survive safe skew — not a substitute for impact planning |

Spine α stays: Launcher is not a long-lived fleet supervisor. **Plan** is Lookup/Node-shaped; Launcher executes spawn units from the plan.

### Deferred open (resolve when this bake starts — after Versioned)

- API home: `Lookup.planUpdate` vs `Node.planUpdate`  
- Force flag when impact is non-empty  
- Discovering clients-at-risk without a client registry  
- Tie-in to explicit A/B launcher / `restartSuccessor`

---

## End-to-end skew story (one narrative)

```ts
// shared/jobs.ts — both A and B import this after B's deploy
export class JobV1 extends Schema.Class<JobV1>("jobs/payload@1")({ /* … */ }) {}
export class JobV2 extends Schema.Class<JobV2>("jobs/payload@2")({ /* … */ }) {}
export class JobV3 extends Schema.Class<JobV3>("jobs/payload@3")({ /* … */ }) {}
export const Job = Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV3)
export class Jobs extends WorkPool.Tag<Jobs>()("fleet/Jobs", { payload: Job }) {}

// Node A (old binary tip @2): advertises schemaVersion "jobs/payload@2"
// Node B (tip @3): Directory-visible first, then Node.shutdown(A)
// release @2 → B enqueue decode → JobV3 automatically
// lookupClient on tip @3; app only constructs JobV3
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
- Chain-level `.id()` (identity is per tip schema)  
- `Schema.Class.extend` as a migration mechanism  
- Versioning Nodes / Tags / Specs under `Versioned`  
- Keeping numeric `WorkPool.withSchemaVersion` alongside Versioned  
- Eng before owner go on this file  

---

## Eng gate (when owner says go)

**Versioned v1**

1. `Versioned` module + typed builder + brand + `isVersioned` + `schemaVersion` (Class.identifier → else AST hash)  
2. Retire public `withSchemaVersion` / numeric store path → string stamps  
3. Wire `schemaVersion` on status service row for WorkPool payload  
4. Client + serve codec hooks  
5. Handoff / `releaseEnqueueHandoff` + durable reopen hooks  
6. Tagged errors + `versioned.test-d.ts` contiguous-chain asserts  
7. Guide + runnable example  
8. Changeset (minor)  
9. Brief #35 → superseded (already pointed here)

**Out of Versioned Eng v1:** non-payload leaves; `restartSuccessor`; Directory column.

**After Versioned (queued, already designed above — do not start early):**

1. `Hyperlink.deprecated` dual (pipe-canonical)  
2. Update-impact planner (`Lookup`/`Node` + Launcher executes plan)  
3. Explicit A/B / `restartSuccessor` (behind impact)

---

## Open at Eng only (not product forks)

- Exact AST-hash algorithm parity with `contractHash` fingerprint helpers (reuse if possible).  
- Legacy durable INTEGER → string read rule for one release.
