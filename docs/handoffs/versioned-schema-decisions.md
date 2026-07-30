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

## Locked

### 1. Module = own namespace `hyperlink-ts/Versioned`

- Public: `src/Versioned.ts` (flat Effect-true exports) + `src/internal/versioned.ts`.
- Barrel: `export * as Versioned from "./Versioned"`.
- `package.json` exports subpath `./Versioned`.
- Apps: `import * as Versioned from "hyperlink-ts/Versioned"`.
- **Rejected:** nest under `Hyperlink.Versioned` object-namespace; `*Contract` / `*Migration` orphan modules; annotation-only module with no Schema carrier.

### 2. Carrier = Versioned schema value (same Tag slot — no extra params)

- `Versioned.make(origin).migrate(…).migrate(…)` produces a value that **is** (or brands) a `Schema` for the **current** tip.
- WorkPool (and later any Spec leaf) keeps a **single** field:

```ts
class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job, // Versioned tip ≡ Schema<JobV3>
}) {}
```

- **No** parallel `versions:` / `migrations:` Tag param.
- Plain `Schema.Struct(…)` remains a one-version payload (no chain).
- **Rejected:** `versions` beside `payload`; Handle-carried version bags; forcing every payload to be Versioned.

### 3. Builder typing = contiguous tip (compile error on gaps / wrong order)

```ts
declare namespace Versioned {
  export interface VersionedSchema<
    Current extends Schema.Top,
    Origin extends Schema.Top,
  > extends /* Current as Schema */ {
    readonly current: Current // or self
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

- Each `.migrate(next, step)` requires `step` decode **Current → Next** (upcast) and encode **Next → Current**.
- Skipping a hop or passing a transform for the wrong tip → **TypeScript error**.
- Runtime: steps stored for path compose (`SchemaTransformation.compose`).

**Author UX:**

```ts
import * as Versioned from "hyperlink-ts/Versioned"
import { Schema, SchemaTransformation } from "effect"

const toV2 = SchemaTransformation.transform({
  decode: (j: typeof JobV1.Type) => ({ ...j, priority: 0 }),
  encode: ({ priority: _, ...j }: typeof JobV2.Type) => j,
})
const toV3 = SchemaTransformation.transform({
  decode: (j: typeof JobV2.Type) => ({
    id: j.id,
    body: { note: j.note, priority: j.priority },
  }),
  encode: (j: typeof JobV3.Type) => ({
    id: j.id,
    note: j.body.note,
    priority: j.body.priority,
  }),
})

const Job = Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV3)
```

### 4. Metadata home = wrapper / symbol — not Schema.annotate alone

- Effect `Schema.annotate` is for inert docs/JSON-Schema metadata — **insufficient** for executable `Transformation` steps.
- Load-bearing chain lives on a **Versioned brand** (symbol / internal field) readable by seams via `Versioned.isVersioned`.
- Optional: annotate tip with a human `schemaVersion` string for docs; runtime identity is locked in #6.
- **Rejected:** storing transform fns only in annotations; serializing the chain across the wire.

### 5. App surface = always current; transforms are automatic

- `yield* Jobs` / enqueue / RPC args & returns are **current** types only.
- **No** happy-path `Versioned.upgrade` / `Hyperlink.upgrade` in app code.
- Seams detect peer/storage version vs Tag tip and apply the composed path.
- Optional `@internal` / test helper to compose a path for unit tests — not a product API.

### 6. Version identity on the wire

| Signal | Meaning |
|--------|---------|
| `schemaVersion` | Stable id of the **tip** Schema this process speaks for that leaf (string; mint rule Eng-time — prefer content-addressed AST hash or explicit `.id("v3")` on builder — **pick at Eng**, default content-hash of tip AST) |
| `contractHash` | Unchanged F4 fingerprint of the **current whole Spec** (methods + current leaves) |

- Advertise / node status / Directory row (or readiness service row) carries `schemaVersion` **per Versioned leaf** that needs skew (v1: WorkPool payload).
- Peer older / newer / equal compared by `schemaVersion` against local chain tip + known step ids.
- **Rejected:** replacing `contractHash` with versions; dual opaque hashes with no path semantics.

### 7. Who applies (direction)

- **Newer side** owns the chain (both peers import the same Tag → same `Versioned` value).
- Inbound bytes at version `V_from` → upcast to local current before app/handlers see them.
- Outbound to an older peer → downcast from current to `V_to` when speaking their version.
- Handoff: outgoing A may release in A’s native version; incoming B (or the codec on B’s enqueue path) upcasts to B current. Prefer **decode at the receiving current side** so A need not know B’s newer Schema.
- **Rejected:** requiring apps to pick direction; “only server upgrades.”

### 8. Seams that auto-apply (v1 scope)

| Seam | Behavior |
|------|----------|
| Addressed / lookup **client** decode | Upcast responses if peer older; downcast requests if peer older |
| **Serve** decode | Upcast requests if client older; downcast responses if client older |
| **Handoff** release → enqueue | Receiving current side upcasts released payloads |
| **Durable store** reopen | Upcast stored rows written at older tip |

- If the Schema is **not** Versioned → today’s behavior (no path; `contractHash` mismatch stays fail-loud).
- If Versioned but **no path** from peer/storage version → loud typed error (see #9). Never silent passthrough of wrong shape.

### 9. Errors (tagged only)

```ts
// names final at Eng — shape locked
MigrationPathMissing   { serviceKey, leaf, from, to }
MigrationDecodeFailed  { serviceKey, leaf, from, step }
```

- Match `_tag`, never message strings.
- `ContractMismatch` remains for whole-Spec / non-Versioned drift.
- Path missing is **not** softened to verify-off.

### 10. Where the chain is known (Tag, not Handle)

- Versioned value is part of the Tag’s Spec leaf (payload Schema).
- Anyone who imports the Tag (client or server) has the chain — Handle stays current-typed API only.
- **Rejected:** putting `versions` on the Handle; requiring a separate client migration pack.

### 11. Grain / rollout

- **v1 leaf:** WorkPool `payload` only.
- Later: any Spec Schema leaf (`ref` element, custom effect I/O) may be a Versioned schema the same way — still one slot per leaf.
- Daemon / Gate handoff remain opt-in `{ handoff }` fns; they can reuse Versioned payloads when those schemas are Versioned.
- **Rejected:** Versioned for the entire RpcGroup Spec as one blob in v1; DB/SQL migrations as this module’s job.

### 12. Relation to existing tracks

| Track piece | Interaction |
|-------------|-------------|
| `#39` serve `{ handoff }` | Unchanged API; codecs inside release/enqueue auto-apply Versioned |
| WorkPool `releaseEnqueueHandoff` | Bake uses payload Schema; if Versioned, auto upcast on peer enqueue decode |
| `#35` contract ranges | **Superseded by this bake** — path-in-chain replaces “negotiation ranges” |
| `contractHash` / verify | Keep; Versioned adds `schemaVersion` path when leaf is Versioned |
| Policy / lookupClient | Unchanged dial story; decode layer applies Versioned |

---

## Dream API (canonical sketch)

```ts
import * as Versioned from "hyperlink-ts/Versioned"
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Schema, SchemaTransformation } from "effect"

const JobV1 = Schema.Struct({ id: Schema.String, note: Schema.String })
const JobV2 = Schema.Struct({
  id: Schema.String,
  note: Schema.String,
  priority: Schema.Number,
})
const JobV3 = Schema.Struct({
  id: Schema.String,
  body: Schema.Struct({ note: Schema.String, priority: Schema.Number }),
})

const Job = Versioned.make(JobV1)
  .migrate(
    JobV2,
    SchemaTransformation.transform({
      decode: (j) => ({ ...j, priority: 0 }),
      encode: ({ priority: _, ...j }) => j,
    }),
  )
  .migrate(
    JobV3,
    SchemaTransformation.transform({
      decode: (j) => ({
        id: j.id,
        body: { note: j.note, priority: j.priority },
      }),
      encode: (j) => ({
        id: j.id,
        note: j.body.note,
        priority: j.body.priority,
      }),
    }),
  )

class Jobs extends WorkPool.Tag<Jobs>()("app/Jobs", {
  payload: Job,
}) {}

// App — current only
const jobs = yield* Jobs
yield* jobs.add({
  id: "1",
  body: { note: "hi", priority: 2 },
})
// Seams auto-transform when peer/storage schemaVersion ≠ tip
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

1. `Versioned` module + typed builder + brand + `isVersioned`  
2. Wire `schemaVersion` on status / advertise for Versioned WorkPool payload  
3. Client + serve codec hooks  
4. Handoff / `releaseEnqueueHandoff` + durable reopen hooks  
5. Typed errors + `.test-d.ts` contiguous-chain asserts  
6. Guide page + one example (old peer / store reopen)  
7. Changeset (minor)  
8. Update `#35` in launcher brief → “superseded by Versioned”  

**Out of Eng v1:** steady-state dual-version without `schemaVersion` advertise; non-payload leaves; `restartSuccessor`.

---

## Open at Eng only (not product forks)

- Exact `schemaVersion` mint (explicit `.id("v3")` vs AST content hash) — recommend **AST content hash of tip** with optional `.id` override for stable human labels.  
- Whether Directory gets a column vs readiness `services[].schemaVersion` — prefer **status service row** next to existing `contractHash` to avoid Directory schema churn in v1.
