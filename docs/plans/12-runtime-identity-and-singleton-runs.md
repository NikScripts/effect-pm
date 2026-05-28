# 12 — Runtime identity, singleton runs, and duplicate prevention

**Status:** Design capture (conversation May 2026). **Do not implement** until
sections marked **Discuss after doc** are resolved with the owner.

**Related:** [09-standalone-spawns.md](./09-standalone-spawns.md),
[STORAGE.md](../STORAGE.md), [13-queue-rate-limit-and-operational-storage.md](./13-queue-rate-limit-and-operational-storage.md),
[PROCESS-API.md](../PROCESS-API.md).

---

## Goals

1. **One logical identifier must not have more than one live supervisor** for the
   scope we care about (see layers below).
2. **`instanceId` is required** — `runId` alone is **not** sufficient to model
   activation, correlation, or cross-runtime exclusivity.
3. **Restrictions must guarantee no duplicates** — not best-effort logging.
4. **Split responsibility by runtime boundary:**
   - **Same OS process / same program:** orchestration (`ProcessGroup`, spawn
     registry, definition-time validation) must **guarantee** no duplicate live
     instance for the same logical id.
   - **Another process or host:** **durable storage** (shared `RuntimeStorage`)
     must **guarantee** no duplicate live instance elsewhere — acquire before
     start, release on stop, transactional where needed.

**Correction (owner, May 2026):** An earlier note that “storage must not be used
for duplicate detection” was **wrong**. Storage is the cross-runtime authority;
in-process enforcement is separate and also mandatory.

---

## Identifier vocabulary (do not conflate)

| Id | Role today / intended | Notes |
|----|------------------------|-------|
| **Definition id** | `Process.make(id, …)` → `process.name`; queue tag `key` | Stable in code and contracts. |
| **`runId` (spine)** | Minted once per composed facet spine (`makeRunId` at layer build) | Stamped on **every** row from that spine session. **Insufficient** alone for singleton semantics or per-activation correlation. |
| **`runId` (RunResource payload)** | Per worker invocation in queue/run facts | Domain telemetry; not the spine session id. |
| **`instanceId` (required, planned)** | **Live activation** of a logical process (or spawn handle) | Must be designed: minting, persistence, indexed columns, lease lifecycle. **Discuss after doc** (§ Deferred). |
| **Spawn suffix id** | `@repo/.../MyProcess#instanceName` or `#<generated>` | Only when **multiple instances are allowed** (logs, correlation). See plan 09. |
| **Service / definition id** | `Process.make("@repo/.../MyProcess")`, `QueueResource` tag key, etc. | **Singleton** — do **not** append `#instanceName` on service classes or group entries meant to be one logical resource. |

---

## Duplicate prevention — two layers (mandatory)

### Layer 1 — Same program (in-process)

| Mechanism | Status | Requirement |
|-----------|--------|-------------|
| `ProcessGroup` + `FiberMap` | **Shipped** | Second `start(sameName)` → `ProcessAlreadyRunningError`. |
| Duplicate entries at group **definition** | **Gap** | `processMap` / `queueMap` silently overwrite on duplicate `Process.name` or queue tag keys. **Must** fail at `makeProcessGroup` / `makeTypedProcessGroup` with typed error. |
| `Process.spawn` registry | **Not shipped** | Must enforce one live fiber per spawn id in caller scope / global registry (design TBD). **Discuss after doc** (§ B). |
| `startAll` / CLI / manager | **Partial** | Inventory mentions avoiding duplicate child launches; must align with `instanceId` + storage lease. |

### Layer 2 — Elsewhere (cross-process / cross-host)

| Mechanism | Status | Requirement |
|-----------|--------|-------------|
| **Durable exclusivity via `RuntimeStorage`** | **Not shipped** | Before supervisor starts, **acquire** exclusivity for `(logicalId)` or `(logicalId, instanceId)`; on stop/crash, **release** or TTL stale reclaim. Must use **transactions** (see plan 13) for atomic check-and-set. |
| Hybrid / Redis `RuntimeStorage` adapter | **Planned** | Leases and rate state route inside **one** `RuntimeStorage` (see plan 13) — not a separate app-level Redis layer. |

Storage is **not** optional for multi-runtime deployments: without shared storage,
only Layer 1 applies.

---

## What storage rows are for (identity facet)

Planned **`ProcessStoreInstance`** (name TBD) or extension of lifecycle/execution
facets:

- **Operational state row(s)** per logical id / instance: `running | stopped`,
  `holder` (host/pid optional), `leasedAt`, `instanceId`.
- **Facts / audit:** start, stop, duplicate rejected, lease lost.
- **Not** “infer duplicates by querying historical `runId`” — exclusivity must be
  **active lease**, not analytics.

Exact wire types, indexes (`processId` + `key` + `type`), and facet subpath —
**Discuss after doc** (§ Deferred).

---

## `Process.spawn` API (agreed sketch)

```ts
const process = Process.make("@repo/package/dirOrGroup/MyProcess", …);

Process.spawn("instanceName", process);
// logical id → @repo/package/dirOrGroup/MyProcess#instanceName

Process.spawn(process);
// logical id → @repo/package/dirOrGroup/MyProcess#<generated>
```

- **`ProcessGroup`** remains fleet map + `ControlService` targets.
- Spawned handles: caller-scope `Effect` (suspend / wake / shutdown), orthogonal
  to schedule `armed`.
- Singleton rules for spawn ids must compose **Layer 1 + Layer 2** like group
  processes.

Full handle shape: [09-standalone-spawns.md](./09-standalone-spawns.md).

---

## Today’s code references

- Registry overwrite: `src/ProcessGroup.ts` (`processMap.set(p.name, p)` loop).
- In-process running check: `FiberMap.has` → `ProcessAlreadyRunningError`.
- Spine `runId`: `src/internal/store/helpers.ts` (`makeRunId`), `service.ts`
  (`buildStore`).

---

## Extend `configure` / `Service` on other resource types

Do not forget parity beyond queues when identity and hooks land:

| Module | `configure` / `Service` today | Extend for |
|--------|-------------------------------|------------|
| `QueueResource` | **Yes** — patches, `wrapWorker`, `rateLimit` (plan 13) | `rateLimit`, hooks, storage-backed options |
| `Process` | **Yes** — `Process.Service.configure` | lifecycle hooks, lease options, spawn-related config |
| `RunResource` | **Yes** | `RateLimiter` options (scout), concurrency + storage state |
| `HttpApiResource` | **Verify / extend** | Same `ResourceConfigure` pattern as RunResource |
| Future resources | — | Must use `configureLayer` / `foldConfig` / `ConfigPatch`, not ad hoc env flags |

See [resource-configure.md](../guides/resource-configure.md) and plan **13** for
queue `rateLimit` as the reference implementation.

---

## Owner decisions (recorded)

| Question | Decision |
|----------|----------|
| **`#instanceName` on ids** | For **multi-instance** spawns only (logs, correlation). **Service classes / singleton resources** use the base id — **no** `#instance` on `Process.Service`, `QueueResource` tags, etc. |
| **Storage unavailable at start** | **Log error** (exact fail vs continue — refine when lease API is wired). |
| **Lease key** | **Deferred** with A4–A5 (`instanceId`); likely base `processId` for singletons, suffixed id only when multi-instance is intentional. |

### Still open (next slice vs later)

1. **Next code slice order:** (a) `ProcessGroup` duplicate definition validation, (b)
   `RuntimeStorage.transaction`, (c) lease facet — owner picks order.

### Deferred — discuss after doc (documented, not blocking plan write)

### A4–A5 — `instanceId` design

- Where minted (group `start` vs spawn vs schedule-driven instance).
- Column placement on `RuntimeRecord` vs payload-only.
- Relationship to spine `runId` on writes (both stamped? replace?).
- Restart semantics: new `instanceId` per activation vs stable across pause.

### B — Singleton matrix (full)

- Exact key for cross-runtime lease: `processId` only vs `processId#instance`.
- Behavior when storage unavailable (fail closed vs in-process only).
- Interaction with `ProcessManager` / remote start / `group-start` CLI.
- Crash recovery: TTL, fencing tokens, stale lease takeover.
- Typed errors: duplicate at definition vs duplicate at start vs duplicate
  cross-host.

---

## Implementation slices (ordered, after discussion)

1. Doc updates in [STORAGE.md](../STORAGE.md) + `RuntimeRecord` TSDoc when
   `instanceId` is fixed.
2. `ProcessGroup` duplicate definition validation (in-process, no storage).
3. Instance lease facet + `RuntimeStorage.transaction` (plan 13 dependency).
4. Wire `Process.start` / spawn to acquire-release lease.
5. `Process.spawn` (plan 09) with ids above.

---

## Verification (when implemented)

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

**Changeset:** required for public errors, facet subpaths, lease APIs.
