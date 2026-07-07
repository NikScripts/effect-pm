# Result / error schemas on tag factories + RPC schema safety

**Status:** Design locked in conversation (2026-07-06, revised late evening). **Process tag positional
API + store contract shipped** on `cursor/process-tag-schemas-a3ad`. **Not implemented** on queues /
RR / CQR (other branches). **`Process.result` pipe deprecated** in favor of positional tag args +
config-object overload.

Companion to [`store-and-logs-design.md`](./store-and-logs-design.md),
[`queue-persistence-design.md`](./queue-persistence-design.md),
[`2026-07-06-processstore-removal.md`](./2026-07-06-processstore-removal.md).

---

## Decisions locked

### 1. No pipe combinators — positional schemas on `Tag` only

**Retired:** `.pipe(Process.result(schema))`, planned `QueueResource.result`, etc.

**SSOT:** schemas are declared on the **tag factory** only (positional args or config-object
overload). Layer config must not override them (see §3).

| Resource | Required | Optional 2nd | Optional 3rd | Config-object overload |
|----------|----------|--------------|--------------|------------------------|
| **Process** | `key` | `resultSchema` | `errorSchema` | `Tag(key, { resultSchema?, errorSchema?, description?, node? })` |
| **QueueResource** | `key` + **`itemSchema`** | `resultSchema` | `errorSchema` | `Tag(key, { itemSchema, resultSchema?, errorSchema?, description?, node? })` |
| **CustomQueueResource** | `key` + **`itemSchema`** + lane args | `resultSchema` | `errorSchema` | `Tag(key, itemSchema, lanes…, { resultSchema?, errorSchema?, … })` or leading config object — **TBD with CQR agent** |

Disambiguation: when the 2nd argument is a **plain object** with `description` / `node` / schema
keys, it is the **config overload**, not a schema.

**Migration:** deprecate `Process.result`; graft `result` ref + `resultSchemaSym` / `errorSchemaSym`
from tag factory args instead.

### 2. Tag factory forms (canonical)

See conversation summary in repo; full examples in §“Tag factory forms” below.

**Process:**

```ts
Process.Tag()(key)
Process.Tag()(key, resultSchema)
Process.Tag()(key, resultSchema, errorSchema)
Process.Tag()(key, { resultSchema?, errorSchema?, description?, node? })
```

**QueueResource:**

```ts
QueueResource.Tag()(key, itemSchema)
QueueResource.Tag()(key, itemSchema, resultSchema)
QueueResource.Tag()(key, itemSchema, resultSchema, errorSchema)
QueueResource.Tag()(key, { itemSchema, resultSchema?, errorSchema?, description?, node? })
```

**CustomQueueResource** — same three optional schema slots after required `itemSchema`; lane
count / named levels follow (unchanged arity, schemas before or inside config object per CQR
implementer — prefer trailing options bag: `Tag(key, itemSchema, 3, namedLevels, { resultSchema, errorSchema })`).

### 3. Layer-level schema overrides — internal only, strongly discouraged publicly

**Policy:**

- **Tag / registration** is the **SSOT** for `itemSchema` and `resultSchema` on toolkit resources.
- **`QueueLayerConfig` / `ProcessLayerConfig` / `RunResourceConfig`** should **not** advertise
  schema override fields in public TSDoc or guides.
- **Internal** code paths may accept schemas for engine bootstrapping (`makeQueueRuntime` without a
  tag, tests, legacy `Service` factories) — but overriding a tag’s schemas at `layer()` time is
  **unsafe for RPC**: client and server can disagree on wire shape while sharing the same tag key.

**Risk:** remote `Resource.client(Tag)` validates RPC against the tag’s published spec. If the
server `layer()` silently substitutes a different schema, payloads decode wrong or pass validation
with the wrong shape → silent data corruption.

**Public stance:** document as **unsupported / expert-only** if internal escape hatches remain;
prefer compile-time + connect-time failure when layer config schemas ≠ tag schemas.

### 4. RPC schema validation — deferred subsystem, feasible via fingerprints

**Goal:** validate once that client and server agree on wire schemas before trusting RPC traffic.
Skip re-validation when nothing material has changed.

#### What already exists

- `schemaVersionOf` / `withSchemaVersion` on queue item schemas (`internal/queueResource.ts`).
- `makeQueueItemCodecDescriptor` — publishes `id: ${queueId}/item@vN` + JSON Schema draft-07
  snapshot for discovery / drift checks.
- `Resource.Node` / `NodeKey` — transport binding; readiness + `/health` patterns.

#### Proposed model

1. **Codec fingerprint** per schema role on a tag:
   - `item` — already partially there
   - `result` — same machinery when `resultSchema` lands
   - Fingerprint = hash of **canonical JSON Schema** export (or stable AST canonicalization), not
     raw `Schema` reference identity.

2. **Node build identifier** (new metadata on `Resource.Node` or handshake):
   - `buildId` — changes each deploy / artifact build (CI git sha, content hash, user-supplied).
   - Optional `runId` — changes each process start (stricter invalidation).
   - Exposed on connect handshake alongside codec fingerprints.

3. **Validation cache key:**

   ```
   (localNodeId, localBuildId, remoteNodeId, remoteBuildId, codecId) → Validated | Mismatch
   ```

   If both build IDs unchanged since last successful validate → skip JSON Schema / fingerprint
   compare for that codec.

4. **Handshake** (on `Resource.client` / `connect` — design TBD):

   - Client sends: `{ buildId, codecs: [{ role: "item", id, fingerprint }, { role: "result", … }] }`
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
| **B** | Process tag positional `resultSchema` / `errorSchema` + config overload; deprecate `Process.result` | **Done** (`cursor/process-tag-schemas-a3ad`) |
| **B2** | `processStoreSpec` queue-aligned (`event` + `record` / `events`); `test/process-store-contract.test.ts` | **Done** (same branch) |
| **B3** | Engine: `createProcess` writes via `tag.store` not `ProcessExecutionStore` | **Blocked** — default in-memory store (Store Stage 1) |
| **C** | QR / CQR positional schemas + config object (coordinate with queue branches) | **Other agents** — don’t duplicate |
| **D** | RR `resultSchema` config + pipe | Defer until RR branch free |
| **E** | `resultSchema` on store contracts (`processStoreSpec`, `queueStoreSpec`) | After Store Stage 1; Process track |
| **F** | RPC fingerprint handshake + buildId on Node | **Defer** — cross-cutting; ~1 dedicated agent after C stabilizes |

### Spin up an agent now?

| Task | Verdict |
|------|---------|
| Queue tag config-object + dual API | **No** — other agents on queue branches; point them at this doc |
| Process tag `{ resultSchema }` only | **Optional** — low conflict, small PR |
| RPC validation / buildId / fingerprint cache | **Defer** — design is here; implement after tag API lands |
| “Can’t work without schema compare?” | **Unblocked** — fingerprint path is sufficient for v1 |

---

## Open questions (resolve at implement time)

1. **CQR arity** — where does the `{ itemSchema, resultSchema }` object sit relative to lane
   count / named levels? (One leading config object recommended.)
2. **Observation field name** — `result` (Process parity) vs `lastResult` (queue worker semantics)?
3. **`Process.result` removal** — breaking changeset when tag positional API ships?
4. **buildId source** — CI env var vs `package.json` version vs explicit `Node({ buildId })`?
5. **Internal layer override** — remove from types entirely vs `@internal` + runtime `Effect.die` if
   tag vs config mismatch?

---

## Tag factory forms (full examples)

### Process

```ts
const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });
const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

// void — key only
class Health extends Process.Tag<Health>()("app/Health") {}

// value + typed failure
class PricesPos extends Process.Tag<PricesPos>()("app/Prices", Price, FetchErr) {}

// value only (error channel stays unknown / generic)
class PricesValue extends Process.Tag<PricesValue>()("app/Prices", Price) {}

// config object (2nd arg) — same semantics
class PricesCfg extends Process.Tag<PricesCfg>()("app/Prices", {
  resultSchema: Price,
  errorSchema: FetchErr,
  description: "Spot quotes",
}) {}
```

### QueueResource

```ts
const Job = Schema.Struct({ id: Schema.String, text: Schema.String });
const Summary = Schema.Struct({ wordCount: Schema.Number });
const WorkerErr = Schema.TaggedStruct("WorkerError", { reason: Schema.String });

// item only (required) — void worker return
class Mail extends QueueResource.Tag<Mail>()("@app/Mail", Job) {}

// item + result
class Summarize extends QueueResource.Tag<Summarize>()("@app/Summarize", Job, Summary) {}

// item + result + error
class SummarizeE extends QueueResource.Tag<SummarizeE>()("@app/Summarize", Job, Summary, WorkerErr) {}

// config object (2nd arg replaces positional item + optional schemas)
class SummarizeCfg extends QueueResource.Tag<SummarizeCfg>()("@app/Summarize", {
  itemSchema: Job,
  resultSchema: Summary,
  errorSchema: WorkerErr,
}) {}
```

### CustomQueueResource (sketch)

Lane arity unchanged; schemas trail item or sit in options:

```ts
class Jobs extends CustomQueueResource.Tag<Jobs>()(
  "@app/Jobs",
  Job,
  3,
  { urgent: 0, normal: 1, bulk: 2 },
  { resultSchema: LaneMeta, errorSchema: WorkerErr },
)
```

---

## References

- `Process.result` — **to deprecate** (`src/Process.ts`)
- `schemaVersionOf` / `makeQueueItemCodecDescriptor` — `src/internal/queueResource.ts`
- `Resource.Node` / `NodeKey` — `src/Resource.ts`
- Queue store contract — `src/internal/store/queueStoreSpec.ts` (`queueEvent(itemSchema)`)
