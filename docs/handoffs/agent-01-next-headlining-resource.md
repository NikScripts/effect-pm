# Agent 1 — Research: next headlining resource (fleet / peers)

**Status:** **PLAN-FIRST / RESEARCH ONLY** — owner 2026-07-13.  
**Agent:** Agent 1 (free).  
**Branch from (required):** **`integration`** (Logs Phase 5 / #30 and ProcessStorage retirement are already folded).  
**Why:** research and any later impl must sit on the current integration tip so fleet work does not fork pre-Logs.  
**Research branch:** after pull, create `cursor/<short-name>-a3ad` off `integration` **only if** you need to commit findings docs — prefer posting research in owner chat first. **No implementation** until owner picks a direction.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`phase5-logs-migration-review.md`](./phase5-logs-migration-review.md) · [`multi-host-instances-decisions.md`](./multi-host-instances-decisions.md) · [`docs/standards/resources.md`](../standards/resources.md)

---

## Owner steer

- **QueueResource** and **Process** are the top two toolkit resources.
- **RunResource is lackluster** as a product headline — engine is fine; it does not carry the same story (fleet, dashboard, docs, package subpath, RPC depth).
- Owner is interested in leaning into **fleet / peer** features for the next headline — ideally the **first resource where mesh exists from day one**, not bolted on after the fact (unlike Queue/Process, which stay primarily node-bound).
- **You do not decide.** Present options, evidence, and a numbered owner decision checklist. Wait for approval before any build.

---

## Mission

Research whether the next headlining resource should:

1. **Upgrade RunResource** into a fleet-aware story, or  
2. **Productize an existing dogfood** (e.g. `WorkerPool` in `examples/resource-web`), or  
3. **Invent a new first-class toolkit module** built on `Resource.distributed` / `peers` / `MultiNode` from the start.

Deliver a research write-up in owner chat (and optionally commit a findings note under `docs/handoffs/` only if the owner asks). **No implementation.**

---

## Why this exists

Fleet/peer machinery already shipped (`Resource.distributed`, `Resource.peers`, `Resource.peersLayer`, `MultiNode.combine*`). The live showcase is a **custom tag** (`WorkerPool` in resource-web), not a toolkit sibling. Queue/Process never absorbed fleet as a built-in story. The question is what becomes the **third headlining resource** that owns that narrative.

---

## Inputs (read before writing)

| Source | Why |
|--------|-----|
| `src/RunResource.ts`, `src/internal/runResource.ts`, `src/internal/runResourceSchema.ts` | What Run is today |
| `src/HttpClientRunGate.ts` | Companion niche |
| `docs/guides/run-resources.md` | Stub guide — product gap |
| `docs/handoffs/store-cutover-runresource.md`, `run-resource-hardening-review.md`, `reports/2026-07-07-agent-report-run-resource.md` | Engine/store status (largely done) |
| `src/Resource.ts` — `fleet`, `distributed`, `peers`, `peersLayer`, `selfNode`, `fleetHealth` | Mesh primitives |
| `src/MultiNode.ts` | Combine folds |
| `docs/handoffs/multi-host-instances-decisions.md` | SSOT (names may say Host/MultiHost — code is Node/MultiNode) |
| `docs/standards/resources.md` | Locked peer/fleet rules |
| `docs/handoffs/2026-07-01-wow-sports-multi-host-findings.md` | Consumer FleetDatabase findings |
| `docs/handoffs/2026-07-02-peerslayer-eager-stream-connect-deadlock.md` | Lazy peers lesson |
| `examples/resource-web/hub.ts`, `server.ts` | WorkerPool dogfood |
| `examples/web-dashboard/fleet.ts` | “Fleet” UI = Group tree, **not** peers mesh — don’t conflate |
| `src/Telemetry.ts`, `docs/handoffs/telemetry-resource.md` | Adjacent observability candidate |
| `package.json` exports | RunResource lacks dedicated subpath; Process/Queue/MultiNode have them |

---

## Deliverable (owner chat — five sections)

### 1. RunResource vs Queue / Process — evidence

Short table: store, RPC surface, refs/dashboard, docs/examples, package subpath, fleet usage. Conclude with evidence for “engine OK / product lackluster” — or challenge it if the code contradicts.

### 2. Fleet / peers today — what works, what is incomplete

Map the shipped APIs and who uses them. Separate:

- **Mesh peer model** (`Resource.peers` / `distributed`)
- **Dashboard “fleet” Group tree** (`web-dashboard/fleet.ts`) — different meaning

Call out deferred items from multi-host decisions (coordinator, same-host multiplicity, fleet `/health`, etc.) without proposing to reopen them unless needed.

### 3. Candidate space (options only — no winner)

At least these five, each with pros/cons and day-one fleet story:

| ID | Candidate |
|----|-----------|
| A | Upgrade **RunResource** → fleet-native gate / observability |
| B | Productize **WorkerPool** as first-class toolkit module |
| C | Invent **FleetStatus / FleetResource** (wow-sports Database health pattern) |
| D | Elevate **Telemetry** as the fleet headline |
| E | New **work router** (cross-node `run` / load-aware dispatch) beside local Run |

Feel free to add one more only if evidence demands it.

### 4. Owner decision checklist (numbered)

Every architectural choice becomes a question. Include at least:

1. Headline job — finish Run parity vs showcase mesh vs cross-node routing vs fleet health/metrics  
2. Reuse RunResource vs new module name  
3. Built-in fleet fields on Queue/Process later? or leave engines node-bound  
4. Cross-node `run` semantics (local-only + report-out vs peer redirect vs shared capacity)  
5. Persistence — per-node journals only vs aggregated fleet analytics  
6. Dashboard investment — first-class widgets vs “tools not widgets”  
7. Package/docs bar for calling something “headlining” (subpath + guide + resource-web leaf)  
8. Telemetry as headline vs infrastructure under another resource  
9. Keep “fleet health ≠ `/health`” locked?  
10. Coordinator in scope or explicitly out?

### 5. Risks & non-goals

What this research is **not** solving (e.g. Logs follow-ups, substrate retirement, CustomQueue store). What would prove a chosen candidate ready for an implementation brief.

---

## Rules

- **No code** (except optional readonly probes / existing tests already in tree)
- **No new feature branch** for research write-up in chat
- **No PR for implementation**
- **No recommendations** unless the owner asks — options + checklist only
- **Stop** after posting the research

---

## After owner picks a direction

Supervisor (or Agent 1 under a new brief) writes an **implementation handoff** with locked decisions. That is a separate session.

---

## Short prompt (paste to Agent 1)

```
Checkout / pull Agent 2’s branch first:
  git fetch origin cursor/phase5-logs-migration-a3ad
  git checkout cursor/phase5-logs-migration-a3ad
  git pull

Read docs/handoffs/agent-01-next-headlining-resource.md (and Inputs). Branch any research commits FROM that tip — do not base on bare integration/storage.

You are Agent 1. RESEARCH / PLAN ONLY — no implementation.

Deliver the five sections: (1) Run vs Queue/Process evidence, (2) fleet/peers today, (3) candidate options A–E with pros/cons, (4) numbered owner decision checklist, (5) risks & non-goals.

Present options — do not pick a winner. Lean into how fleet/peer features could be first-class from day one. Then stop and wait for owner approval.
```
