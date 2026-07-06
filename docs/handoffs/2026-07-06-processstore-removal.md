# ProcessStore removal → new Store (events) + SQL (durable) — migration plan

Definitive, code-verified plan to **delete ProcessStore entirely** and put `QueueResource` (and the
other consumers) on the new `Store` for events and SQL/Persistence for everything else. Every claim
below was checked against the tree on 2026-07-06.

## Verified ground truth (2026-07-06)

- **The new `Store` works and is tested.** `src/Store.ts` — `Store.contract` / `Store.Service` /
  `Store.register` / `Store.extend` / `Resource.store` / `Tag.store`, `.layerMemory`, handle
  `shape.append` / `shape.read` + custom methods. `test/store.test.ts` (13) + `test/store.sqlite.test.ts`
  (6) = **19 green**. Backed by `effect/unstable/eventlog` `EventJournal` (memory + SQLite journals).
- **`QueueResource.store(Tag)` registration is implemented** (`QueueResource.ts:949`) — builds
  `builtInQueueStoreContract(tag)`: a single **`entry`** shape (`queueId` / `entryId` / `item`) with
  `recordEntry` (append) + `entries` (read). Merges app-specific shapes via `Store.extend`.
- **Durability is done.** Presence-driven `serviceOption(DurableQueueStore)`; the public `persist`
  field + `QueuePersistOptions` are **removed**. Typecheck (both projects) + LS clean; 81 queue tests
  green. (Breaking — changeset drafted in `.changeset/`.)
- **The engine is NOT on the new Store yet.** `src/internal/queueResource.ts` still appends to the old
  `QueueResourceStore` facet via `Effect.serviceOption` + `recordStoreWrite` +
  `ProcessStore.catchErrorAndLog` (≈ lines 118, 2306, 2424–2517). This is the reverted-sink territory.
- `RunResource.ts` emits are stubbed to `Effect.void` (earlier "comment out ProcessStore" pass).

## The two blockers (must be resolved before clean engine wiring — both yours)

1. **Baked-in in-memory default store is not implemented.** `Tag.store` **fails** with
   `StoreScopeNotRegistered` (`src/internal/store/memoryScope.ts:178`) when no `Store.Service` layer is
   provided — today the app must register *and* provide the store. The agreed model is a **default
   in-memory (bounded) store** so the engine always has a handle and needs **no** `serviceOption` and no
   presence-branching. This is core resolution behavior in the 24-file `internal/store/*` subsystem —
   your code, your call; not something to hack blind.
2. **Queue event-taxonomy scope is undecided.** The new queue contract is deliberately **minimal**
   (`entry` only). The old facet carried a rich taxonomy: 9 `queue.entry.*` statuses, 6
   `queue.lifecycle.*`, 3 `queue.dedupe-key.*`, `queue.ratelimit.exceeded`, plus the full `QueueEntryFact`.
   **Decision needed:** which of those come forward onto `builtInQueueStoreContract`? (a) entry-only
   (current), (b) entry + lifecycle, (c) full port. This shapes both the contract and the engine's emit
   sites — inventing it is what's been rejected before.

## Staged plan — each stage gated on: `tsgo` both projects + Effect LS + affected tests all green

- **Stage 0 — durability serviceOption + `persist` removed. ✅ DONE.**
- **Stage 1 — baked-in default store (blocker 1, your Store internals).** `Tag.store` resolves to a
  bounded in-memory store when unprovided instead of failing. Enables no-serviceOption wiring downstream.
- **Stage 2 — finalize the queue event contract (blocker 2, decision).** Extend
  `builtInQueueStoreContract` to the agreed taxonomy scope; add `.test-d.ts` coverage.
- **Stage 3 — wire the engine to the new Store.** The queue **layer** (which holds the tag) resolves
  `yield* tag.store` → the handle, threads it into the engine (the clean version of the reverted
  `eventSink`: buffered off the worker hot path). Delete `storeOption` / `recordStoreWrite` /
  `ProcessStore.catchErrorAndLog` and the `QueueResourceStore` import. **No `serviceOption`** — the
  handle is always real (Stage 1). This is the concrete "QueueResource set up with the new store."
- **Stage 4 — migrate the remaining consumers off ProcessStore:**
  - `RunResource.ts` — its stubbed emits → `Resource.store(RunResource, …)` events (or drop observation
    pending the rename/rewrite it needs anyway).
  - `Process.ts` (your active file) — `ProcessExecutionStore` writes → `Process.store(Tag)`; the logs
    read/append (`store.read`/`append` at ~2159/2216) → `Resource.logs`.
  - `NodeLogs.ts` / `Logs.ts` / `internal/manager/*` — platform logs (`Node.logs` / `Resource.logs`).
  - `Query.ts`, `HistoryStore.ts` — delete.
  - `storage/redis/*`, `storage/sqlite/*` (old `RuntimeStorage` adapters + codecs) — delete/replace;
    keep the SQLite `Store`/`EventJournal` backing and the durable-queue port.
- **Stage 5 — delete ProcessStore + retire the old facet plumbing.** Remove `ProcessStore.ts`,
  `ProcessStorage.ts`, `ProcessStoreEvent.ts`, `src/store/*`, the superseded `internal/store` facet
  plumbing, `RuntimeStorage.ts`; drop the `index.ts` exports + `package.json` subpaths (changeset).
  Delete the facet tests (`*-store-facet.test.ts`, `log-query`); migrate the domain tests.

## Consumer graph (files that import ProcessStore / a facet today)

Domain emitters (migrate): `Process.ts`, `RunResource.ts`, `internal/queueResource.ts`.
Log subsystem (rewrite): `Logs.ts`, `NodeLogs.ts`, `LogContext.ts`, `internal/manager/{logQuery,logPersistRelay}.ts`, `store/log.ts`.
Infra (delete): `ProcessStore.ts`, `ProcessStorage.ts`, `ProcessStoreEvent.ts`, `Query.ts`, `HistoryStore.ts`, `RuntimeStorage.ts`, `src/store/*`, old `storage/{sqlite,redis}/*`, `internal/store/*` facet plumbing.
Keep: `LogEntry.ts` (schema reused), `LogContext.ts` annotation keys (rename `queueId`→`resourceId`).
Tests: delete `*-store-facet.test.ts` + `log-query.test.ts`; migrate `process`, `queue-resource`, `run-resource`, `process-lifecycle`, `logs`, `log-pipeline`, `host-logs-history`.

## What I did NOT touch tonight (and why)

The engine wiring (Stage 3) and the default-store machinery (Stage 1) are blocked on your two decisions
and sit in your active Store internals. Building them speculatively would repeat the revert cycle. Stage
0 is shipped and verified; this plan + the changeset are the safe, high-value increments.
