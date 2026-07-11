# Handoff: unify tag schema config names → RPC names (`payload`, `success`, `error`)

**Status:** Locked (2026-07-07). **RunResource + Process + Queue/CQR rename landed** on `integration/storage`.  
**Per-module agent reports:** [`reports/README.md`](./reports/README.md)  
**Companion design doc:** [`result-schema-and-rpc-validation.md`](./result-schema-and-rpc-validation.md) (RPC fingerprint / buildId — deferred)

**Integration branch:** `integration/storage` (2026-07-10).

---

## Decision (locked)

Replace all **public tag / service / wire-config** schema property names with the same vocabulary **`Resource` already uses on the wire**:

| RPC role | New config name | Retire |
|----------|-----------------|--------|
| Request / input / item | **`payload`** | `inputSchema`, `itemSchema`, … |
| Success / return / result | **`success`** | `successSchema`, `resultSchema`, … |
| Failure channel | **`error`** | `errorSchema` (name stays, meaning aligned) |

**SSOT:** `Resource.effectFn(success, { payload, error })`, `Resource.ref`, stream methods — see `src/Resource.ts` TSDoc (`payload` / `success` / `error`).

**Policy:** No backward-compat shims (`@deprecated` aliases, re-exports under old names). One breaking changeset; update every in-repo callsite, test, example, and doc in the same change.

---

## Per-module agent reports

Work is split for **parallel agents** — see [`reports/README.md`](./reports/README.md):

- [RunResource](./reports/2026-07-07-agent-report-run-resource.md) — finish + verify (mostly done)
- [Process](./reports/2026-07-07-agent-report-process.md) — `error` wiring, engine store tap, remove `Process.result`
- [QueueResource + CQR](./reports/2026-07-07-agent-report-queue-resource.md) — ✅ config-object `{ payload, success?, error? }` shipped
- [Store](./reports/2026-07-07-agent-report-store.md) — bridge typing, default store, engine gaps
- [Docs + release](./reports/2026-07-07-agent-report-docs-release.md) — changesets, stale doc sweep

---

## Per-resource mapping

### RunResource — **rename in place** (highest churn on current branch)

| Today | Target |
|-------|--------|
| `RunResourceWireSchemas.inputSchema` | `payload` |
| `RunResourceWireSchemas.successSchema` | `success` |
| `RunResourceWireSchemas.errorSchema` | `error` |
| `RunResourceTagSchemas` / `RunResourceServiceConfig` fields | same |
| Positional `Tag()(key, input, success, error?)` | `Tag()(key, payload, success, error?)` |
| Config object `{ inputSchema, successSchema, errorSchema? }` | `{ payload, success, error? }` |
| `runSpec(inputSchema, …)` internal factory args | rename params to match (already wires `payload`/`success`/`error` to `Resource.effectFn`) |

**Already aligned internally:** `src/internal/runResourceSchema.ts` — `run` method uses `{ payload: inputSchema, error: errorSchema }` with `successSchema` as first arg. Public names are the mismatch.

**Do not rename:** store fact field names (`run-resource.run.*`), `RunGateStatus`, engine `effect(input)` layer configs unless explicitly part of this pass (layer config has no schema fields today).

### Process — **rename + finish wiring**

| Today | Target |
|-------|--------|
| `ProcessTagOptions.resultSchema` | `success` |
| `ProcessTagOptions.errorSchema` | `error` |
| Positional `Tag()(key, resultSchema, errorSchema?)` | `Tag()(key, success, error?)` |
| `resultSchemaSym` / `resultSchemaOf` | `successSchemaSym` / `successSchemaOf` (or `successSym` — pick one symbol name and use consistently) |
| `errorSchemaSym` / `errorSchemaOf` | keep `error*` or shorten to match |

**No `payload` on Process tag** — the managed process effect is not an RPC call with a per-invocation payload schema. Document as **two-slot** API (`success`, `error`) unless a future handoff adds a trigger payload.

**Critical — `error` is decorative today:** third positional arg / `errorSchema` is stamped on the tag and exported via `errorSchemaOf`, but **not used** by supervisor, RPC spec build, or store (`RunFailed.error` is still `Schema.String`). Renaming without behavior is another half-ship — **minimum bar for this pass:**

1. Rename config fields to `success` / `error`.
2. Either wire `error` into RPC spec + store failed events **or** remove `error` from public Tag API until wired (owner call at sync — prefer wire + store in same PR if timeboxed).

**Store wire fields (locked 2026-07-07):** persisted terminal rows use **`success`** and **`error`**
(slot names match the tag). `RunCompleted.success` / `Completed.success` — not `result`. See
`store-cutover-00-store-core.md` §5 for `_tag` (PascalCase) and `error` encoding.

**Remove `Process.result` pipe** in the same PR (already `@deprecated`). No dual API after rename.

**Engine → `Process.store`:** **done** — `Process.layer` writes **`Process.store(tag)`** only; **`ProcessExecutionStore` facet deleted**.

### QueueResource — **done on `integration/storage`**

| Was | Shipped |
|-----|---------|
| `itemSchema` (positional + tag stamp) | **`payload`** (positional 2nd arg or `{ payload }`) |
| (planned) `resultSchema` / `errorSchema` | optional **`success`** / **`error`** (positional or object) |

Files: `src/QueueResource.ts`, `src/CustomQueueResource.ts`, `src/internal/store/queueStoreSpec.ts`, `builtInQueueStoreContract`, tests, queue guides.

**Queue store `entry.item`:** domain field on persisted rows — stays `item`; tag config uses `payload`.

### CustomQueueResource — **done** (same as QueueResource)

Config object `{ payload, levelCount, namedLevels?, success?, error? }`. One agent owns CQR + QR together — **shipped**.

---

## Critical notes from integration merge (do not ignore)

### 1. Branch name vs deliverable

`cursor/integration-result-schema-a3ad` was **Process-only** (one commit). It did **not** integrate Queue / RunResource / RPC validation despite the name. Treat [`result-schema-and-rpc-validation.md`](./result-schema-and-rpc-validation.md) as **roadmap**, not shipped behavior.

### 2. RunResource vs Process persistence asymmetry (post-merge)

| | RunResource (`cursor/run-resource-handle-observable-a009`) | Process (integration branch) |
|--|--|--|
| Tag config schemas | `inputSchema` / `successSchema` / `errorSchema` → **rename to payload/success/error** | `resultSchema` / `errorSchema` → **success/error** |
| `*.store(tag)` contract | ✅ built-in facts + state | ✅ built-in `event` union (result-aware) |
| Engine auto-write to new Store | ✅ declared `Storage` tap + merged `Store.layerDefaultMemory` | ✅ `processStoreTap.ts` (declared `Storage`) + `withDefaultMemory` |
| Engine auto-write to legacy facet | ❌ **`RunResourceStore` deleted** | ❌ **`ProcessExecutionStore` deleted** — `Process.store` only |
| `error` schema behavior | on RPC wire via `runSpec` | stamped only |

Rename agent: Process engine tap now matches RunResource on the cutover branch; consolidate docs at release.

### 3. `msgpackr` direct dependency — likely mistake

Integration commit added `"msgpackr"` to `package.json` claiming journalCodec typecheck fix. **`src/internal/store/journalCodec.ts` uses Effect `Msgpack` only**; comment says no direct `msgpackr`. RunResource branch had removed direct `msgpackr`. **Verify on fresh install; remove `msgpackr` from `package.json` if nothing imports it.** Do not reintroduce alongside rename unless a real consumer exists.

### 4. Symbol.for stamp keys are public contract

Process stamps `@nikscripts/effect-pm/Process/resultSchema` today. Renaming to `success` changes runtime symbol identity — **breaking** for any external reader of symbols. Grep `Symbol.for("@nikscripts/effect-pm/` across repo; update store specs (`resultSchemaOf` → `successSchemaOf`), tests, and changeset.

### 5. Layer-level schema override remains forbidden publicly

Renaming does not relax rule: **tag is SSOT** for wire schemas. Layer config must not override `payload` / `success` / `error`. Internal engine bootstrapping escape hatches (if any remain) stay `@internal`.

### 6. RPC fingerprint / buildId — still deferred

Rename unblocks consistent handshake design in `result-schema-and-rpc-validation.md` §4. **Out of scope** for rename PR unless explicitly scheduled at sync.

---

## Files to touch (checklist)

### RunResource (current branch — primary)

- `src/RunResource.ts` — types, Tag/Service overloads, module doc
- `src/internal/runResourceSchema.ts` — `runSpec` param names
- `test/run-resource.test.ts`, `test/run-resource-remote-http.test.ts`, `test/store.test.ts`
- `examples/forms/resource/*`, `examples/forms/process-store/process-store-events-sqlite-layer.ts`
- `docs/RESOURCE-API.md`, `docs/CODEBASE-INVENTORY.md`, `docs/guides/resource-configure.md`
- `.changeset/run-resource-handle-rpc-store.md` — **merge into** new rename changeset or replace

### Process (merged integration)

- `src/Process.ts`, `src/internal/processTagSchemas.ts`, `src/internal/processEvent.ts`, `src/internal/store/processStoreSpec.ts`
- `test/process-store-contract.test.ts`, `test/process-contract-shape.test-d.ts`, `test/process-toolkit.test.ts`
- `docs/guides/process.md`, `docs/PROCESS-API.md`
- Remove `Process.result`

### Queue + CustomQueue (same PR)

- `src/QueueResource.ts`, `src/CustomQueueResource.ts`, `src/internal/queueResource.ts`, `src/internal/customQueueResource.ts`
- `src/internal/store/queueStoreSpec.ts`
- All `test/queue*.ts`, queue examples, `docs/guides/queue-resource.md`

### Cross-cutting

- `docs/handoffs/result-schema-and-rpc-validation.md` — update tables or mark superseded
- `CHANGELOG.md` / new `.changeset/*.md`
- `examples/README.md`, `docs/PACKAGE-GUIDE.md`, `docs/STORAGE.md`

**Do not edit:** `repos/`

---

## Suggested implementation order (one sync, one PR)

1. **Rename `Resource`-adjacent internal helpers first** (`runSpec`, `queueSpec`, `makeProcessExecutionEvent` params) so compiler drives callsites.
2. **RunResource + Process in parallel** (already divergent naming — biggest user-visible delta).
3. **QueueResource + CustomQueueResource** (avoid leaving `itemSchema` beside RR `payload`).
4. **Docs + examples + changeset** in same commit series.
5. **Drop `msgpackr`** if unused.
6. **Full verify** (below).

Avoid splitting rename across multiple open PRs — drift between Process `success` and Queue `resultSchema` was the problem this decision fixes.

---

## Verification (must be green before merge)

```bash
pnpm run typecheck
pnpm exec vitest run test/run-resource.test.ts test/run-resource-remote-http.test.ts \
  test/process-toolkit.test.ts test/process-store-contract.test.ts \
  test/queue-resource.test.ts test/queue-contract.test.ts test/store.test.ts
pnpm run lint
pnpm run build
```

Spot-check examples:

```bash
npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts
```

---

## Changeset

Single **minor** (beta) breaking entry, e.g. `.changeset/rpc-schema-names-payload-success-error.md`:

- Rename all tag/service schema config fields to `payload` / `success` / `error`
- Remove `Process.result`
- Remove `RunGate` (already gone on RunResource branch)
- Symbol stamp renames for Process
- Migration snippets per resource (no dual names)

Coordinate with existing `.changeset/run-resource-handle-rpc-store.md` — consolidate so release notes are one coherent RunResource + schema rename story.

---

## Open questions for sync (resolve in room, not in agent silence)

1. **Process `error`:** wire + store in rename PR, or drop from Tag until wired?
2. **Store persisted fields:** `RunCompleted.success` / `Completed.success` (locked); queue `entry.item` stays `item` (enqueue payload domain name).
3. **Symbol names:** `successSchemaSym` vs `successSym`?
4. **Queue positional arity:** `Tag()(key, payload, success?, error?)` — confirm order matches RunResource.
5. **Process engine → `Process.store`:** separate agent immediately after rename, or same sprint?

---

## References (current shapes)

- Wire SSOT: `src/Resource.ts` (`effectFn`, `Method` types)
- RunResource wire factory: `src/internal/runResourceSchema.ts`
- Process tag stamps: `src/internal/processTagSchemas.ts`
- Process store contract: `src/internal/store/processStoreSpec.ts`
- Queue tag/spec: `src/QueueResource.ts` (`queueSpec`, tag config `payload`)
- RunResource engine store tap: `src/internal/runResourceStoreTap.ts`
- Prior design (partially stale): `docs/handoffs/result-schema-and-rpc-validation.md`
