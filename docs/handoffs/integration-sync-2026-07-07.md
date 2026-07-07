# Integration sync — 2026-07-07

**Branch:** `cursor/integration-result-schema-a3ad` (`ef914ab` and later)  
**Purpose:** One place to see **what landed since the last merge**, which **module note to read**, and **open issues** for cross-agent review. Detailed work lives in linked handoffs — this file does not duplicate them.

---

## What was new since merge `25aba6d` (your last known tip)

| Commit | Owner / area | Summary |
|--------|----------------|---------|
| `4597ee1` | **Store** | Generic `bridge.at<Input>` → precise `StoreHandleOf<Input>`; `Tag.store` typed; consumer casts removed |
| `1c76643` | **Queue** | **Store cutover** handoffs (`store-cutover-00` … `store-cutover-customqueue.md`) — Stage 1 default store **done**, shared `storeTap.ts` plan, per-module cutover tasks |
| `997a89d` | **RunResource** | RPC naming handoff (`2026-07-07-rpc-schema-names-payload-success-error.md`) |
| `4d45702` | **RunResource** | **Agent reports** under `docs/handoffs/reports/` (Process, Queue, RunResource, Store, docs-release) |
| `ef914ab` | **Integration** | Merge of run-resource reports + store-cutover docs on one branch |

**Already on integration before `25aba6d`:** Process tag + store contract (`00227c2`), RunResource handle/RPC/store (`2c8a95e`), `payload`/`success`/`error` rename, `layerDefaultMemory` + `store-default.test.ts`.

---

## Which doc to read (avoid redundancy)

Two report sets exist — use **both**, for different layers:

| Layer | Path | Use when |
|-------|------|----------|
| **Naming + RPC policy** | [`result-schema-and-rpc-validation.md`](./result-schema-and-rpc-validation.md) | Tag factory shapes, no layer overrides, fingerprint deferred |
| **Rename execution** | [`2026-07-07-rpc-schema-names-payload-success-error.md`](./2026-07-07-rpc-schema-names-payload-success-error.md) | File checklist, breaking symbol renames |
| **Agent reports (review)** | [`reports/README.md`](./reports/README.md) | Blind spots, shipped vs open, per-owner priorities |
| **Store cutover (engine)** | [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) + module `store-cutover-*.md` | **Authoritative for Store Stage 1 + engine wiring** — supersedes stale lines in agent reports |
| **ProcessStore removal** | [`2026-07-06-processstore-removal.md`](./2026-07-06-processstore-removal.md) | End-state migration stages, facet deletion |

**Supersedes / corrections (read before trusting older agent report lines):**

1. **Store Stage 1** — `store-cutover-00` says **done** (`layerDefaultMemory`, `buildDefaultScopeBridge`). The Store agent report still says “blocked” — **ignore that**; engines still need to **compose** the default layer (not wired into `Process.layer` / `QueueResource.layer` yet).
2. **Lazy store resolution** — ~~RunResource agent report treats lazy bridge as acceptable~~ **Done on run-resource branch:** declared `StoreScopeBridgeTag` dependency; app provides `Store.layerDefaultMemory` at root. Process/Queue still need the same cutover.
3. **Queue Tag `payload`** — Integration **already** renamed `QueueResource.Tag(key, itemSchema)` → `Tag(key, payload)` (positional). Queue agent report “not renamed” is **stale**. Still open: **`success`/`error` triplet**, config-object overload, tag stamps, engine cutover.
4. **Process symbols** — `successSym` / `successOf` (not `resultSchemaSym`). `store-cutover-process.md` still mentions `resultSchemaOf` in one bullet — treat as `successOf`.

---

## Per-module — status & issues for review

### Store (platform)

**Read:** [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) · [`reports/2026-07-07-agent-report-store.md`](./reports/2026-07-07-agent-report-store.md)

| Shipped | Open |
|---------|------|
| `layerDefaultMemory`, precise `bridge.at`, typed `Tag.store` | Shared **`storeTap.ts`** (queue prototypes) |
| Effect Msgpack journal (no direct `msgpackr`) | Wire default store into resource `layer`/`serve` |
| Cast-free queue contract (reference) | Process/RunResource cast removal on contracts |

**Discuss / approve:** Forked-fiber eager resolve vs any remaining lazy path; whether `success` value is persisted on store completion rows (store-core TODO §3).

---

### Process

**Read:** [`store-cutover-process.md`](./store-cutover-process.md) · [`reports/2026-07-07-agent-report-process.md`](./reports/2026-07-07-agent-report-process.md)

| Shipped | Open |
|---------|------|
| `Tag(key, success?, error?)`, `successOf`/`errorOf` | **`error` stamped but unused** (RPC + store still `String`) |
| `builtInProcessStoreContract`, `Process.store` | Engine still **`ProcessExecutionStore` only** |
| `process-store-contract.test.ts` | `processStoreTap.ts` + shared `storeTap.ts` |
| `Process.result` deprecated | Remove `Process.result` (no shim policy) |

**Discuss / approve:** Wire `error` into typed `RunFailed` vs drop from Tag until wired; dual-write vs cutover for execution events; symbol rename in changeset.

**Blind spot (RunResource agent):** Process has no `payload` on tag — two-slot only. Do not add without product call.

---

### QueueResource + CustomQueueResource

**Read:** [`store-cutover-queue.md`](./store-cutover-queue.md) · [`store-cutover-customqueue.md`](./store-cutover-customqueue.md) · [`reports/2026-07-07-agent-report-queue-resource.md`](./reports/2026-07-07-agent-report-queue-resource.md)

| Shipped | Open |
|---------|------|
| `Tag(key, payload)` positional rename | `success` / `error` on Tag + stamps |
| `builtInQueueStoreContract` (cast-free) | Config-object `{ payload, success?, error? }` |
| Store typing + default bridge | **Build-time store resolve deadlocks** — use `storeTap.ts` |
| | Engine: `publishEvent` → store, drop facet tier |
| | Event taxonomy: entry-only vs full lifecycle (**owner decision**) |

**Discuss / approve:** Queue agent owns `storeTap.ts` prototype; CQR trailing `{ success?, error? }` arity (see customqueue handoff).

**Blind spot (Process agent):** WIP `queue-store-wiring` on branch `queue-store-wiring` — do not merge build-time resolution.

---

### RunResource

**Read:** [`store-cutover-runresource.md`](./store-cutover-runresource.md) · [`reports/2026-07-07-agent-report-run-resource.md`](./reports/2026-07-07-agent-report-run-resource.md)

| Shipped | Open |
|---------|------|
| `.run` handle, RPC serve, `payload`/`success`/`error` | Doc sweep + consolidated changeset |
| `RunResource.store`, dual-write (facet + Store) | Drop legacy facet (**owner decision**) |
| Declared-dependency store tap + cast-free contract | Optional write-path buffer (queue may add) |
| `Store.layerDefaultMemory` public export | Wire default store into Process/Queue layers (their agents) |
| Remote HTTP test, changeset draft | `Resource.httpServer` overload vs `StoreScopeNotRegistered` |

**Discuss / approve:** When to drop legacy `RunResourceStore` facet (after Process/Queue cutover?).

**Blind spot (Queue agent):** ~~RunResource report says “lazy at write time is required for Layer.mergeAll siblings”~~ **Resolved:** declared dependency + `Layer.provideMerge(Store.layerDefaultMemory)` at app root.

---

### Docs + release

**Read:** [`reports/2026-07-07-agent-report-docs-release.md`](./reports/2026-07-07-agent-report-docs-release.md)

| Open |
|------|
| Single platform changeset for rename + RunResource breaking API |
| Grep sweep: `itemSchema`, `inputSchema`, `resultSchema`, `RunGate`, callable `gate(` |
| `PROCESS-API.md`, `STORAGE.md`, examples README after engine taps land |

---

## Cross-cutting — needs owner decision

| # | Topic | Options | Notes |
|---|--------|---------|-------|
| 1 | **Store event taxonomy (queue)** | entry-only vs lifecycle vs full facet port | Blocks queue store contract final shape |
| 2 | **`error` on Process tag** | Wire to RPC + typed `RunFailed` vs remove until wired | Stamped today, consumed nowhere |
| 3 | **Shared `storeTap.ts`** | Queue prototypes; Process + RunResource adopt | Replaces lazy + build-time resolve |
| 4 | **Default store in resource layers** | Auto-merge `layerDefaultMemory` in `Process.layer` / `QueueResource.layer` / `RunResource.layer` | Stage 1 exists but not composed |
| 5 | **Legacy facet dual-write** | Keep until all engines cut over vs stop new dual-write | RunResource + future Process tap |
| 6 | **CQR tag arity** | Trailing `{ success?, error? }` after lanes | [`store-cutover-customqueue.md`](./store-cutover-customqueue.md) |

---

## Agent workflow

1. `git fetch origin && git merge origin/cursor/integration-result-schema-a3ad` (or work directly on integration).
2. Read **this file** + your module’s **store-cutover-** + **agent-report-** links.
3. Post review notes in your module handoff (append “Review YYYY-MM-DD” section) or open PR against integration.
4. Do **not** re-document Store Stage 1 or naming — link here.

**Verify:**

```bash
pnpm run typecheck
pnpm test
```

---

## File index (integration branch)

```
docs/handoffs/integration-sync-2026-07-07.md     ← this file (start here)
docs/handoffs/reports/README.md                  ← agent reports index
docs/handoffs/store-cutover-00-store-core.md     ← store engine policy (authoritative)
docs/handoffs/store-cutover-{process,queue,runresource,customqueue}.md
docs/handoffs/result-schema-and-rpc-validation.md
docs/handoffs/2026-07-07-rpc-schema-names-payload-success-error.md
docs/handoffs/2026-07-06-processstore-removal.md
```
