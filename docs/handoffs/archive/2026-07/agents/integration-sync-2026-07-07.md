# Integration sync — 2026-07-07

> **2026-07-09 (`integration/storage`):** Agent 1 Session 2 — `STORAGE.md` golden-model rewrite.
> Agent 2 Session 1 — cast-free Process store contract (`9dab7a3`).
> **Active sessions:** Agent 1 → [`agent-01-session-2-storage-docs.md`](agent-01-session-2-storage-docs.md);
> Agent 2 → [`agent-02-session-2-process-platform.md`](agent-02-session-2-process-platform.md).

**Branch:** `cursor/integration-result-schema-a3ad` (`ef914ab` and later)  
**Purpose:** One place to see **what landed since the last merge**, which **module note to read**, and **open issues** for cross-agent review. Detailed work lives in linked handoffs — this file does not duplicate them.

---

## What was new since merge `25aba6d` (your last known tip)

| Commit | Owner / area | Summary |
|--------|----------------|---------|
| `4597ee1` | **Store** | Generic `bridge.at<Input>` → precise `StoreHandleOf<Input>`; `Tag.store` typed; consumer casts removed |
| `1c76643` | **Queue** | **Store cutover** handoffs (`store-cutover-00` … `store-cutover-customqueue.md`) — Stage 1 default store **done**, declared-dependency engine policy |
| `997a89d` | **RunResource** | RPC naming handoff (completed; date-stamped checklist removed) |
| `4d45702` | **RunResource** | **Agent reports** under `docs/handoffs/reports/` (Process, Queue, RunResource, Store, docs-release) |
| `ef914ab` | **Integration** | Merge of run-resource reports + store-cutover docs on one branch |

**Already on integration before `25aba6d`:** Process tag + store contract (`00227c2`), RunResource handle/RPC/store (`2c8a95e`), `payload`/`success`/`error` rename, `layerDefaultMemory` + `store-default.test.ts`.

---

## Which doc to read (avoid redundancy)

Two report sets exist — use **both**, for different layers:

| Layer | Path | Use when |
|-------|------|----------|
| **Naming + RPC policy** | [`result-schema-and-rpc-validation.md`](./result-schema-and-rpc-validation.md) | Tag factory shapes, no layer overrides, fingerprint deferred |
| **Agent reports (review)** | [`reports/README.md`](./reports/README.md) | Blind spots, shipped vs open, per-owner priorities |
| **Store cutover (engine)** | [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) + module `store-cutover-*.md` | **Authoritative for Store Stage 1 + engine wiring** — supersedes stale lines in agent reports |

**Supersedes / corrections (read before trusting older agent report lines):**

1. **Store Stage 1** — `store-cutover-00` says **done** (`layerDefaultMemory`, `buildDefaultScopeBridge`). The Store agent report still says “blocked” — **ignore that**. **Process**, **RunResource**, and **Queue** merge the default into `layer` / `serve` / `serveRemote` via `Layer.provideMerge(Store.layerDefaultMemory)` (Process via `withDefaultMemory`). Apps override at root with `Layer.provideMerge(AppStore.layerMemory, ...)`.
2. **Lazy store resolution** — ~~RunResource agent report treats lazy bridge as acceptable~~ **Resolved:** declared **`Storage`** dependency (`yield* Storage`); no `serviceOption`, no forked-fiber `storeTap.ts` helper (discarded in `b4bf1de`). **`RunResource.layer` / `Process.layer` / `QueueResource.layer`** all merge `layerDefaultMemory` by default.
3. **Queue Tag wire** — **Shipped on `integration/storage`:** config-object-only `Tag(key, { payload, success?, error?, … })` on QueueResource, CustomQueueResource, Process, RunResource. Tag stamps (`successOf` / `errorOf`) drive store wire. Positional schema overloads retired.
4. **Process symbols** — `successSym` / `successOf` (not `resultSchemaSym`). `store-cutover-process.md` still mentions `resultSchemaOf` in one bullet — treat as `successOf`.
5. **Deleted helpers / facets** — `processStoreTap.ts` deleted (Process inlines store wiring in `buildProcessImpl`). **`ProcessExecutionStore`** and **`QueueResourceStore`** legacy facets deleted from `src/` — engine paths use `materializeEngineQueueStore*` + declared `Storage`.

---

## Per-module — status & issues for review

### Store (platform)

**Read:** [`store-cutover-00-store-core.md`](./store-cutover-00-store-core.md) · [`reports/2026-07-07-agent-report-store.md`](../reports/2026-07-07-agent-report-store.md)

| Shipped | Open |
|---------|------|
| `layerDefaultMemory`, precise `bridge.at`, typed `Tag.store` | Optional write-path buffer (queue engine — **future**) |
| Effect Msgpack journal (no direct `msgpackr`) | |
| Cast-free queue + run-resource + process contracts | |
| Process / RunResource / Queue / CQR default store baked into toolkit layers | |
| All four toolkit engines on Store bridge (`materializeEngineQueueStore*`, `Store.effects`) | |

**Discuss / approve:** Whether `success` value is persisted on store completion rows (store-core TODO §3).

---

### Process

**Read:** [`store-cutover-process.md`](./store-cutover-process.md) · [`process-store-cutover-review.md`](process-store-cutover-review.md) · [`reports/2026-07-07-agent-report-process.md`](../reports/2026-07-07-agent-report-process.md)

| Shipped | Open |
|---------|------|
| Config-object `Tag` with `{ success?, error? }`, `successOf`/`errorOf` | **RPC `error` wire blocked** — store uses typed/fallback `Failed.error` (store-core §5); RPC spec unchanged (Session 2) |
| `builtInProcessStoreContract` (cast-free), `Process.store`, engine `store.record` path | |
| `withDefaultMemory` on `layer` / `serve` / `serveRemote` | |
| `ProcessExecutionStore` facet deleted; `Process.result` removed | |
| `Started` / `Completed` / `Failed` / `Interrupted` store rows + tests | |
| `process-store-contract.test.ts`, `process-store-engine.test.ts`, sqlite typed-error test | |

**Owner decision (RPC):** Process has no request/response worker RPC like RunResource `run`. Wiring tag
`error` onto `processSpec` would require per-tag spec rebuild (mirror `runSpec` in
`src/internal/runResourceSchema.ts:30`). Until then, `error` is **store-only**. See agent report for
file:line evidence.

**Blind spot (RunResource agent):** Process has no `payload` on tag — two-slot only. Do not add without product call.

---

### QueueResource + CustomQueueResource

**Read:** [`store-cutover-queue.md`](./store-cutover-queue.md) · [`store-cutover-customqueue.md`](./store-cutover-customqueue.md) · [`reports/2026-07-07-agent-report-queue-resource.md`](../reports/2026-07-07-agent-report-queue-resource.md)

| Shipped | Open |
|---------|------|
| Config-object-only `Tag` with `payload` / optional `success` / `error` (QR + CQR) | Write-path buffer off hot path (**future** — see `store-cutover-queue.md`) |
| `builtInQueueStoreContract` (cast-free); full lifecycle event taxonomy (owner locked) | |
| Engine store: `materializeEngineQueueStore*` + declared `Storage`; `layerDefaultMemory` on toolkit layers | |
| `Resource.builtResource` + `grantLocal` on QR + CQR `layer` / `serve` / `serveRemote` | |
| `publishEvent` → materialized store (`recordToStore`); legacy `QueueResourceStore` facet **deleted** | |
| CQR shares `QueueEvent<T>` + optional result schemas — see [`store-cutover-customqueue.md`](./store-cutover-customqueue.md) | |

**Discuss / approve:** None blocking store cutover close-out on this branch.

---

### RunResource

**Read:** [`store-cutover-runresource.md`](./store-cutover-runresource.md) · [`reports/2026-07-07-agent-report-run-resource.md`](../reports/2026-07-07-agent-report-run-resource.md)

| Shipped | Open |
|---------|------|
| `.run` handle, RPC serve, `payload`/`success`/`error` | Consolidated platform changeset (docs agent) |
| `RunResource.store`, Store-only engine tap | Optional write-path buffer (queue may add — **future**) |
| Declared-dependency store tap + cast-free contract | |
| `Store.layerDefaultMemory` merged into layer entry points | |
| Remote HTTP test, doc sweep | |
| **`RunResourceStore` facet deleted** | |

**Done:** Legacy `RunResourceStore` facet removed from ProcessStorage, exports, and build.

**Blind spot (Queue agent):** ~~RunResource report says “lazy at write time is required for Layer.mergeAll siblings”~~ **Resolved:** declared **`Storage`** dependency + `layerDefaultMemory` merged into RunResource layer entry points (override via app-root `AppStore`).

---

### Docs + release

**Read:** [`reports/2026-07-07-agent-report-docs-release.md`](../reports/2026-07-07-agent-report-docs-release.md)

| Open |
|------|
| Single platform changeset for rename + RunResource breaking API |
| Grep sweep: `itemSchema`, `inputSchema`, `resultSchema`, `RunGate`, callable `gate(` |
| `PROCESS-API.md`, `STORAGE.md`, examples README after engine taps land |

---

## Cross-cutting — needs owner decision

| # | Topic | Status | Notes |
|---|--------|--------|-------|
| 1 | **Store event taxonomy (queue)** | ✅ **Locked** — full lifecycle | Owner decision in `store-cutover-queue.md`; persisted == streamed |
| 2 | **`error` on Process tag** | **Store ✅ / RPC blocked** | Store: `Process.ts:581-596` `recordStoreFailed`. RPC: `processSpec` at `Process.ts:1548-1569` uses `Schema.Never`; `errorSym` stamped at `Process.ts:1889-1890` but not grafted onto spec (contrast `runSpec` at `runResourceSchema.ts:30`) |
| 3 | **Engine store tap pattern** | ✅ **Shipped** | Declared **`Storage`** + `materializeEngineQueueStore*` (Queue/CQR); Process inlines in `buildProcessImpl`; RunResource `runResourceStoreTap.ts` |
| 4 | **Default store in resource layers** | ✅ **Shipped** | `Layer.provideMerge(Store.layerDefaultMemory)` on Process, RunResource, Queue, CQR toolkit entry points |
| 5 | **Legacy facet dual-write** | ✅ **Done** | **`ProcessExecutionStore`**, **`RunResourceStore`**, **`QueueResourceStore`** facets deleted from `src/` |
| 6 | **CQR tag wire** | ✅ **Shipped** | Config object `{ payload, levelCount, namedLevels?, success?, error? }` — see [`store-cutover-customqueue.md`](./store-cutover-customqueue.md) |

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
docs/handoffs/archive/2026-07/agents/integration-sync-2026-07-07.md     ← this file (start here)
docs/handoffs/reports/README.md                  ← agent reports index
docs/handoffs/store-cutover-00-store-core.md     ← store engine policy (authoritative)
docs/handoffs/store-cutover-{process,queue,runresource,customqueue}.md
docs/handoffs/result-schema-and-rpc-validation.md
```
