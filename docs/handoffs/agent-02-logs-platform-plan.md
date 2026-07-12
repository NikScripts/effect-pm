# Agent 2 — Logs platform plan (final session)

**Status:** PLAN-FIRST — owner approval required before any code.  
**Base:** `integration/storage`  
**Branch:** none — planning in owner chat only

**Read first:** [`store-and-logs-design.md`](./store-and-logs-design.md) · [`store-migration-roadmap.md`](./store-migration-roadmap.md) · [`agent-status.md`](./agent-status.md)

---

## Owner steer

- **`main` release deferred** until Logs is designed and implemented.
- **Agent 2's last session** — plan only, then stop.
- **You do not decide.** Present options, trade-offs, and questions. Owner decides everything.

---

## The problem (one paragraph)

We need one system for **capture → store → stream** of logs at **node** and **resource** levels, including **nested `Group` resources**. Today that is split across `NodeLogs`, legacy `LogStore`, per-engine `captureLogs`, contract `logs` groups, and `HistoryStore` side channels. This is architectural — not a mechanical facet migration.

---

## What to read

| Source | Why |
|--------|-----|
| [`store-and-logs-design.md`](./store-and-logs-design.md) | Draft ideas — treat as input, not locked |
| [`store-migration-roadmap.md`](./store-migration-roadmap.md) | What Logs blocks |
| `src/NodeLogs.ts` | Node capture + persist today |
| `src/store/log.ts` | Legacy `LogStore` facet |
| `src/Group.ts` | Nested resource trees |
| `src/Process.ts`, `src/QueueResource.ts` | Contract `logs` + `captureLogs` today |
| `src/internal/nodeStatusResource.ts` | Node `logs` over RPC |

---

## What to deliver (owner chat only — no PR, no branch)

Post a short plan with **options and owner questions**. Do not recommend a winner unless the owner asks.

### 1. System model (three planes)

Describe how capture, stream, and store *could* work. For each plane, list **2–3 options** and what breaks if we pick wrong.

| Plane | Questions to surface |
|-------|-------------------|
| **Capture** | One logger at node root vs per resource? Which annotation keys (`resourceId`, `processId`, `queueId`, group path)? |
| **Stream** | One relay vs many? How to filter per resource vs whole node? |
| **Store** | Node registration vs per-resource `appendLog` vs both — how to avoid duplicate durable lines? |

Include nested `Group` behavior: who emits, who is queried, how dashboard walks the tree.

### 2. API sketch (options only)

Surface choices — do not lock names or shapes:

- `Resource.logs` / `Tag.logs` / `Node.logs` — keep, rename, or other?
- Level pipe (`logStreamLevel`, `logStoreLevel`, `logExportLevel`) vs today's `captureLogs`
- Contract `logs: { stream, query }` on queue/process — remove, keep, or platform-inject?

### 3. Migration outline (phases as options)

Sketch phased cutover (e.g. node store → resource facets → delete facet → contract cleanup). Label each phase **optional split points** — owner picks PR boundaries.

### 4. Owner decision checklist

End with a numbered list of **every decision** the owner must make before implementation. Pull from `store-and-logs-design.md` §Open questions plus nesting / single-write / RPC wire / assignee.

### 5. Risks & non-goals

Brief: what v1 explicitly does not cover; what tests would prove the chosen design.

---

## Rules for this session

- **No code**
- **No branch**
- **No PR**
- **No recommendations** — options + owner questions only
- **Stop** after posting the plan

---

## After owner approval

Supervisor attaches approved decisions to an implementation handoff. Owner picks Agent 1, Agent 2, or a new session for build.

---

## Doc prompt (full brief — paste to Agent 2)

```
Read docs/handoffs/agent-02-logs-platform-plan.md and the inputs it lists.

You are Agent 2 — FINAL SESSION. PLAN ONLY.

Deliver the five sections in the handoff (system model, API sketch, migration outline, owner decision checklist, risks/non-goals).

Rules:
- Present options and trade-offs — do NOT pick winners.
- Every architectural choice becomes an owner question.
- Include nested Group resources in the model.
- Cover capture, store, and stream for both node and per-resource logs.
- No branch, no commit, no PR.

Post in owner chat. Then stop.
```

## Short prompt (paste to Agent 2)

```
Read docs/handoffs/agent-02-logs-platform-plan.md. Plan only — no code.

Deliver: capture/store/stream model (node + resource + nested Groups), API options, migration phases, and a numbered owner decision checklist. Present options — do not decide. Stop and wait for owner approval.
```
