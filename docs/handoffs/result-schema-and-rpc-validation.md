# Tag wire schemas (`payload` / `success` / `error`) + RPC validation

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

> **Per-module agent reports:** [`reports/README.md`](./reports/README.md)

**Status:** Design locked (2026-07-07). Tag factories use **Effect `Hyperlink.Method` slot names** —
`payload`, `success`, `error` — with **no `Schema` suffix**.

**Integration branch (merge target):** `cursor/integration-result-schema-a3ad` — Daemon tag +
store contract, Gate handle/RPC/store, wire-slot naming, Store bridge typing (`4597ee1`).

**Shipped:** Daemon (`success`/`error`), Gate (`payload`/`success`/`error`). **Pending:**
Queue/untyped WorkPool full triplet on tag, Daemon `error` wiring + engine store tap, Store Stage 1 default
backing, engine cutover off legacy facets, docs/changesets sweep.

Companion to [`store-and-logs-design.md`](./store-and-logs-design.md),
[`queue-persistence-design.md`](./queue-persistence-design.md).

---

## Decisions locked

### 0. Wire slot names — `payload`, `success`, `error` (no `Schema` suffix)

Tag factories and config objects use the **same names as `Hyperlink.Method`**:

| Slot | RPC meaning | Daemon | Queue | Gate |
|------|-------------|---------|-------|-------------|
| **`payload`** | Request / enqueue / run input | — (effect in layer) | `add` payload (= work item) | `run` payload |
| **`success`** | Return / worker output / last value | `result` ref (live handle) + **`RunCompleted.success`** (store) | **`Completed.success`** (store) | `run` success |
| **`error`** | Typed failure channel | effect error stamp | worker error (TBD) | `run` error |

**Not tag-factory names:** RPC **procedure** names (`run`, `add`, `status`, `result`, …) and internal
`itemSchema` in engine config (legacy; reads from tag `payload` on `add`).

### 1. No pipe combinators — positional wire schemas on `Tag` only

**Retired:** `.pipe(Daemon.result(schema))`, planned `WorkPool.result`, etc.

**SSOT:** schemas are declared on the **tag factory** only (positional args or config-object
overload). Layer config must not override them (see §3).

| Resource | Required | Optional 2nd | Optional 3rd | Config-object overload |
|----------|----------|--------------|--------------|------------------------|
| **Daemon** | `key` | `success` | `error` | `Tag(key, { success?, error?, description?, node? })` |
| **WorkPool** | `key` + **`payload`** | `success` | `error` | `Tag(key, { payload, success?, error?, description?, node? })` |
| **Gate** | `key` + **`payload`** | `success` | `error` | `Tag(key, { payload, success, error?, description? })` |
| **WorkPool.define (untyped)** | `key` + config object | `payload`, `levelCount`, optional `namedLevels`, optional `success` / `error` | `Tag(key, { payload, levelCount, namedLevels?, success?, error?, description?, node? })` |

Disambiguation: when the 2nd argument is a **plain object** with `description` / `node` / wire-slot
keys, it is the **config overload**, not a schema value.

**Migration:** deprecate `Daemon.result`; graft `result` ref + `successSym` / `errorSym` from tag
factory args. Queue: rename tag arg `itemSchema` → `payload`.

### 2. Tag factory forms (canonical)

See conversation summary in repo; full examples in §“Tag factory forms” below.

**Daemon:**

```ts
Daemon.Service()(key)
Daemon.Service()(key, success)
Daemon.Service()(key, success, error)
Daemon.Service()(key, { success?, error?, description?, node? })
```

**WorkPool:**

```ts
WorkPool.Service()(key, payload)
WorkPool.Service()(key, payload, success)
WorkPool.Service()(key, payload, success, error)
WorkPool.Service()(key, { payload, success?, error?, description?, node? })
```

**Gate:**

```ts
Gate.Service()(key, payload, success)
Gate.Service()(key, payload, success, error)
Gate.Service()(key, { payload, success, error?, description? })
```

**WorkPool.define (untyped)** — config object only; same optional `success` / `error` wire slots as WorkPool
after required lane fields:

```ts
WorkPool.Service /* untyped .Service */()(key, { payload, levelCount, namedLevels?, success?, error?, description?, node? })
```

### 3. Layer-level schema overrides — internal only, strongly discouraged publicly

**Policy:**

- **Tag / registration** is the **SSOT** for `payload` and `success` on toolkit resources.
- **`WorkPoolLayerConfig` / `DaemonLayerConfig` / `GateConfig`** should **not** advertise
  schema override fields in public TSDoc or guides.
- **Internal** code paths may accept schemas for engine bootstrapping (`makeQueueRuntime` without a
  tag, tests, legacy `Service` factories) — but overriding a tag’s schemas at `layer()` time is
  **unsafe for RPC**: client and server can disagree on wire shape while sharing the same tag key.

**Risk:** remote `Hyperlink.client(Tag)` validates RPC against the tag’s published spec. If the
server `layer()` silently substitutes a different schema, payloads decode wrong or pass validation
with the wrong shape → silent data corruption.

**Public stance:** document as **unsupported / expert-only** if internal escape hatches remain;
prefer compile-time + connect-time failure when layer config schemas ≠ tag schemas.

### 5. Store wire — `success`, `error`, `_tag` (locked)

Authoritative detail: [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) §5.

- **`_tag`:** PascalCase discriminators on all built-in store event rows.
- **`success`:** optional on terminal success rows when the tag stamps `success` (`RunCompleted.success`,
  `Completed.success`). Not `result`.
- **`error`:** always on terminal failure rows. Tag stamps `error` → decoded typed value (journal encodes
  on append). No tag `error` → `Schema.String` via `String(findErrorOption ?? squash)`.

**Gate:** store handle (`record` / `facts` / `stateHistory`) is correct; migrate facts from kebab
`type` strings to PascalCase `_tag` and adopt the same `error` rule on `RunFailed` rows.

### 6. RPC schema validation — deferred subsystem, feasible via fingerprints

**Goal:** validate once that client and server agree on wire schemas before trusting RPC traffic.
Skip re-validation when nothing material has changed.

#### What already exists

- `schemaVersionOf` / `withSchemaVersion` on queue item schemas (`internal/workPool.ts`).
- `makeQueueItemCodecDescriptor` — publishes `id: ${queueId}/item@vN` + JSON Schema draft-07
  snapshot for discovery / drift checks.
- `Hyperlink.Node` / `NodeKey` — transport binding; readiness + `/health` patterns.

#### Proposed model

1. **Codec fingerprint** per schema role on a tag:
   - `payload` — queue `add`, run-gate `run`
   - `success` — worker / run return, process `result` ref
   - Fingerprint = hash of **canonical JSON Schema** export (or stable AST canonicalization), not
     raw `Schema` reference identity.

2. **Node build identifier** (new metadata on `Hyperlink.Node` or handshake):
   - `buildId` — changes each deploy / artifact build (CI git sha, content hash, user-supplied).
   - Optional `runId` — changes each process start (stricter invalidation).
   - Exposed on connect handshake alongside codec fingerprints.

3. **Validation cache key:**

   ```
   (localNodeId, localBuildId, remoteNodeId, remoteBuildId, codecId) → Validated | Mismatch
   ```

   If both build IDs unchanged since last successful validate → skip JSON Schema / fingerprint
   compare for that codec.

4. **Handshake** (on `Hyperlink.client` / `connect` — design TBD):

   - Client sends: `{ buildId, codecs: [{ role: "payload", id, fingerprint }, { role: "success", … }] }`
   - Server compares to tag-stamped descriptors.
   - Mismatch → typed defect (`SchemaDriftError` / `CodecMismatchError`) before application RPC.

#### Can we compare schemas without user annotations?

**Yes, practically — via fingerprint, not full AST equality.**

| Approach | Feasible? | Notes |
|----------|-----------|-------|
| TypeScript type equality | No | Erased at runtime; useless for RPC. |
| Effect `Schema` reference equality | No | Two `Schema.Struct({…})` calls ≠ same reference. |
| JSON Schema export + hash | **Yes** | Already used in `makeQueueItemCodecDescriptor`; two
  equivalent schemas may hash differently if AST order differs — mitigate with canonical export or
  require `withSchemaVersion` bump on intentional change. |
| Effect `SchemaAST` structural compare | Maybe | Possible internal API; higher effort; same
  ordering pitfalls. |
| User `schemaVersion` annotation | **Yes** | Explicit contract bump; combine with fingerprint
  for accidental drift detection. |

**Recommendation:** ship **fingerprint + optional `schemaVersion`** first. Do not block result
schema work on full AST equivalence. Document that intentional schema changes must bump
`schemaVersion` (or accept new `codecId`).

#### Without validation

Layer-level schema override + RPC **can work** if you know what you’re doing (same repo, same
deploy, no remote client). It **cannot** be safe by default across client/server without
fingerprints or version stamps.

---

## Implementation order (suggested)

| Step | Scope | Agent now? |
|------|-------|------------|
| **A** | This handoff + align queue branch agents on config-object overload | Done (doc) |
| **B** | Daemon tag positional `success` / `error` + config overload; remove `Daemon.result` | **Done** |
| **B2** | `processStoreSpec` queue-aligned (`event` + `record` / `events`) | **Done** |
| **B3** | Engine: `createProcess` writes via `tag.store` not `ProcessExecutionStore` | **Done** — facet deleted |
| **C** | WorkPool / untyped WorkPool `payload` / `success` / `error` on Tag (coordinate queue branches) | **In progress** |
| **D** | RR `payload` / `success` / `error` on Tag | **Done** (run-resource branch) |
| **E** | `success` on store contracts (`processStoreSpec`, `queueStoreSpec`) | After Store Stage 1 |
| **F** | RPC fingerprint handshake + buildId on Node | **Defer** — cross-cutting; ~1 dedicated agent after C stabilizes |

### Spin up an agent now?

| Task | Verdict |
|------|---------|
| Queue tag config-object + dual API | **No** — other agents on queue branches; point them at this doc |
| Daemon tag `{ resultSchema }` only | **Optional** — low conflict, small PR |
| RPC validation / buildId / fingerprint cache | **Defer** — design is here; implement after tag API lands |
| “Can’t work without schema compare?” | **Unblocked** — fingerprint path is sufficient for v1 |

---

## Open questions (resolve at implement time)

1. **untyped WorkPool arity** — where does `{ payload, success }` sit relative to lane count / named levels?
2. **Observation field name** — `result` (Daemon parity) vs `lastResult` (queue worker semantics)?
3. **`Daemon.result` removal** — **done** on `cursor/process-store-cutover-a3ad`; consolidate changeset at release.
4. **buildId source** — CI env var vs `package.json` version vs explicit `Node({ buildId })`?
5. **Internal layer override** — remove from types entirely vs `@internal` + runtime `Effect.die` if
   tag vs config mismatch?

---

## Tag factory forms (full examples)

### Daemon

```ts
const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

// void — key only
class Health extends Daemon.Service<Health>()("app/Health") {}

// value + typed failure
class PricesPos extends Daemon.Service<PricesPos>()("app/Prices", Price, FetchErr) {}

// value only (error channel stays unknown / generic)
class PricesValue extends Daemon.Service<PricesValue>()("app/Prices", Price) {}

// config object (2nd arg) — same semantics
class PricesCfg extends Daemon.Service<PricesCfg>()("app/Prices", {
  success: Price,
  error: FetchErr,
  description: "Spot quotes",
}) {}
```

### WorkPool

```ts
const Job = Schema.Struct({ id: Schema.String, text: Schema.String });
const Summary = Schema.Struct({ wordCount: Schema.Number });
const WorkerErr = Schema.TaggedStruct("WorkerError", { reason: Schema.String });

// payload only (required) — void worker return
class Mail extends WorkPool.Service<Mail>()("@app/Mail", Job) {}

// payload + success
class Summarize extends WorkPool.Service<Summarize>()("@app/Summarize", Job, Summary) {}

// payload + success + error
class SummarizeE extends WorkPool.Service<SummarizeE>()("@app/Summarize", Job, Summary, WorkerErr) {}

// config object (2nd arg)
class SummarizeCfg extends WorkPool.Service<SummarizeCfg>()("@app/Summarize", {
  payload: Job,
  success: Summary,
  error: WorkerErr,
}) {}
```

### Gate

```ts
class FetchGate extends Gate.Service<FetchGate>()("@app/FetchGate", Symbol, Price, FetchErr) {}
```

### WorkPool.define (untyped) (sketch)

Lane arity unchanged; wire slots trail `payload` or sit in options:

```ts
class Jobs extends WorkPool.Service /* untyped .Service */<Jobs>()(
  "@app/Jobs",
  Job,
  3,
  { urgent: 0, normal: 1, bulk: 2 },
  { success: LaneMeta, error: WorkerErr },
)
```

---

## References

- `Daemon.result` — **removed** (use positional `success` on `Tag`)
- `schemaVersionOf` / `makeQueueItemCodecDescriptor` — `src/internal/workPool.ts`
- `Hyperlink.Node` / `NodeKey` — `src/Hyperlink.ts`
- Queue store contract — `src/internal/store/queueStoreSpec.ts` (`queueEvent(itemSchema)`)
