# Brief — Launcher + node handoff (new agent)

**Status:** plan-first / design bake. **Nothing in the launcher track is locked.**  
**Opened:** 2026-07-25 (owner via Agent G).  
**Audience:** next agent picking up launcher + handoff / migration discussion.

---

## Owner framing (read this first)

### Launcher — expect to start over

Prior notes (`launcher-decisions.md`, Agent F bake) are **reference only**. Treat every “Locked” / “Proposed” row there as **historical opinion**, not binding. You are **just as likely to redesign from scratch**. Do not Eng launcher APIs off that doc without a fresh owner bake.

### Contract drift detection — solid (keep)

F4 / `contractHash` / default-on verify / loud-failures taxonomy **shipped** (Agent E design → Agent 3 Eng). Prefer **reuse** over reinventing. See:

- [`loud-failures-design.md`](./loud-failures-design.md)
- [`verify-connection-classification.md`](./verify-connection-classification.md)
- `Hyperlink.contractHash`, `ContractMismatch`, `NodeStatus.resources[].contractHash`

That stack answers: *“client and server disagree on the wire contract → fail loud.”*  
It does **not** answer cross-version state migration or zero-downtime handoff.

### Prefer existing concepts

**Do not invent new concepts unless they are really, really good.** Prefer `Group`, `Node`, Lookup (`Identity` / `Directory` / `Advice`), `Layer` / `Scope` / `Schedule`, Daemon machinery, existing serve/client surfaces. New nouns need a high bar and owner approval.

---

## Direction the owner wants explored (not locked — discuss)

### 1. Dumb launcher, then exit

- Launcher’s job is **bring-up only**: spawn process(es), then **exit when that job is done**.
- It is **relatively dumb** — not a long-lived supervisor owning the fleet forever.
- Ongoing control lives on **nodes**, especially the **Lookup node**.

### 2. Daemon ownership = the Node

- **As soon as a process starts, it is owned and controlled by the nodes.**
- All process controls (shutdown, drain, restart signals that matter, etc.) go **through the node** — not through a lingering launcher daemon.
- Launcher does not remain the control plane after spawn.

### 3. Lookup directs startup

- When a node goes through startup, the **lookup node tells it what to do** (placement / role / whether to take over, etc. — exact verbs TBD; reuse Lookup surfaces where possible).
- Launcher is not the brain after spawn; Lookup is.

### 4. Version upgrade → handoff

- If the new node is an **updated version of an existing node**, a **handoff** is triggered.
- Each service that **supports** handoff must have handoff **configured in its layers**.
- When handoff completes, the **old node shuts down** (via node control plane, not launcher).
- Mission framing (still design-only): [`node-handoff-mission.md`](./node-handoff-mission.md) — zero-downtime updates + cross-version skew as normal.

### 5. Clients during handoff — open

How **clients** handle node handoff (redirect, dual-serve, drain, retry, discovery) is a large open discussion. Capture options; do not pretend it’s solved. Drift detect (`contractHash`) is substrate, not the full client story.

---

## Reference corpus (non-binding except drift Eng)

| Doc | Use as |
|-----|--------|
| [`launcher-decisions.md`](./launcher-decisions.md) | Prior bake notes — **reference only, not locked** |
| [`node-handoff-mission.md`](./node-handoff-mission.md) | Mission boundaries + hard problems — **not a decisions bake** |
| [`loud-failures-design.md`](./loud-failures-design.md) | Drift / verify — **Eng’d, prefer keep** |
| [`verify-connection-classification.md`](./verify-connection-classification.md) | Deep verify ladder — **Eng’d** |
| [`identity-coordinator.md`](./identity-coordinator.md) + guide | Lookup / identity — shipped control loop to lean on |
| [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) | Catalog / discovery context |

---

## Suggested first moves

1. Repeat back owner framing (dumb launcher → exit; node owns process; Lookup directs; handoff on version upgrade; no new concepts without bar).
2. Inventory what Lookup already exposes that can drive “tell the new node what to do” without new control planes.
3. List handoff options for **stateless vs stateful** services and what “configured in layers” might mean — design only.
4. Separate tracks in writing: **(A) spawn+exit launcher**, **(B) Lookup-directed startup**, **(C) service handoff + old node shutdown**, **(D) client behavior during handoff**.
5. Bring open questions to owner; **no Eng** on launcher until a fresh bake says go.

---

## Out of scope for this brief

- Dashboard / `View` registry redesign (Agent G).
- Reopening named-handles / Soft storage tracks.
- Treating `launcher-decisions.md` “Locked” rows as approved for implementation.

---

## Short prompt (paste to new agent)

```
Read docs/handoffs/launcher-and-handoff-brief.md carefully.

You own launcher + node handoff design discussion. NOTHING about the launcher
is locked — launcher-decisions.md is reference only; expect to start over.
Contract drift detection (contractHash / verify / loud-failures) is solid — reuse it.

Owner intent: dumb launcher that exits when spawn job is done; as soon as a
process starts, nodes own it (all controls through the node); Lookup tells new
nodes what to do; version upgrade triggers handoff (per-service, configured in
layers; old node shuts down when done); clients-during-handoff is open.

Do not invent concepts unless they are really really good. Plan-first; no Eng
until owner bakes items. Repeat the framing back before proposing APIs.
```
