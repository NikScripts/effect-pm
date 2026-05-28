# 14 — Conversation capture (May 2026)

**Purpose:** Index of everything discussed in the identity / storage / queue
rate-limit thread so nothing is lost. **Authoritative detail** lives in linked
plans; this file is the checklist.

**Implement / discuss next:** Only after reading **12** and **13**. Sections
**A4–A5** and **B** in plan 12 are explicitly **deferred**.

---

## Owner corrections recorded here

| Item | Wrong (agent) | Right (owner) |
|------|---------------|---------------|
| A3 | “Do not use storage for duplicate detection” | **Restrictions required.** Same program: orchestration guarantees. **Elsewhere: storage guarantees** no duplicate running. |
| `runId` alone | Sufficient as “storage session” for all semantics | **`instanceId` required**; `runId` not sufficient |
| Redis for rate limits | Sounded required in places | **SQLite + Prisma OK for high volume**; Redis optional scale-out |

---

## Documented in plan files

| Topic | Plan |
|-------|------|
| Identity, `instanceId`, two-layer duplicate prevention, storage leases | [12](./12-runtime-identity-and-singleton-runs.md) |
| Queue `rateLimit`, operational storage, transactions, configure parity | [13](./13-queue-rate-limit-and-operational-storage.md) |
| `Process.spawn` / `QueueResource.open` API sketch | [09](./09-standalone-spawns.md) (extended) |
| Roadmap priority links | [README](./README.md) |
| STORAGE pending bullets | [STORAGE.md](../STORAGE.md) |

---

## Full topic list (from thread)

### Identity & duplicates

- [x] `instanceId` required
- [x] `runId` (spine) = per facet layer build; distinct from RunResource payload `runId`
- [x] Layer 1 in-process: FiberMap, definition-time validation (gap), spawn registry (future)
- [x] Layer 2 cross-runtime: durable lease / exclusivity in `RuntimeStorage`
- [ ] **Deferred:** A4–A5 `instanceId` placement, minting, restart semantics
- [ ] **Deferred:** B full singleton matrix (errors, TTL, remote start, storage-down)

### Process.spawn

- [x] `Process.make("@repo/.../MyProcess", …)`
- [x] `Process.spawn("instanceName", process)` → `#instanceName`
- [x] `Process.spawn(process)` → `#<generated>`
- [x] ProcessGroup stays fleet/control authority

### Storage architecture

- [x] One `ProcessStorage` config: facts + state + audit
- [x] `RuntimeStorage.transaction` prerequisite
- [x] `ProcessStore.state` / mutate DSL gap
- [x] Facets own codecs; no monolith `ProcessStore` reads in domain code

### Queue rate limit (not shipped)

- [x] `rateLimit` not `throttle`; no `duration` field
- [x] `QueueResourceRateLimitOptions` tied to Effect `consume`
- [x] Default `onExceeded: "delay"`
- [x] Before semaphore; `onRateLimitExceeded`; `queue.ratelimit.exceeded`
- [x] `RateLimiterStore` on RuntimeStorage; SQLite/Prisma; Redis optional
- [x] Paused implementation; branch reset `402e733`

### ResourceConfigure / Service classes

- [x] Extend/configure parity: Process, RunResource, HttpApiResource, future resources
- [x] Queue `rateLimit` as reference configure integration

### Other repo arcs (mentioned, not expanded in 12–13)

- Dashboard ops-ui — [dashboard-ops-ui.md](../guides/dashboard-ops-ui.md)
- Prisma adapter landed — [11-storage-prisma-follow-up.md](./11-storage-prisma-follow-up.md)
- Remote queue / analytics — plans 03, 04
- EFFECT-V4 scout RateLimiter on RunResource — not a committed slice

---

## Branches (context only)

| Branch | Note |
|--------|------|
| `cursor/restore-queue-throttle-158c` | Rate limit work reverted; see plan 13 |
| Other `cursor/*-158c` | Dashboard, exports, docs — separate PRs |

---

## Before continuing conversation

1. Read plans **12**, **13**, **09** (spawn section).
2. Schedule discussion for **12 § Deferred** (A4–A5, B).
3. Owner green-light for implementation slices (separate from doc approval).
