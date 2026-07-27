# Brief — Launcher + node handoff (new agent)

**Status:** plan-first / design bake — **spine locked; APIs not locked.**  
**Opened:** 2026-07-25 (owner via Agent G).  
**Audience:** next agent picking up launcher + handoff / migration discussion.

---

## Locked (2026-07-27, owner)

1. **Spine α — dumb spawn-and-exit launcher.** Bring-up only; exits when the spawn job is done. Not a long-lived fleet supervisor. Nodes own processes after start; Lookup is the control brain. (Rejects spine β: launcher-as-`Layer.launch(Fleet…)` lifecycle owner.)
2. **No Eng until API is locked with the owner.** Design → owner go on concrete API surface → then build. No APIs from `launcher-decisions.md` memory.
3. **Bake order:** Track **A** (spawn+exit launcher API) first; then B (Lookup-directed startup), C (handoff), D (clients). Do not tangle tracks.
4. **Track A exit gate = Ready** (not merely spawned, not Lookup-registered). Launcher waits until the child is ready, then exits. Registration / Lookup remains the child’s (node’s) job after that.
5. **Launcher → node ownership transfer is explicit** — not only “process is up, launcher walks away.”
6. **Track A handoff shape = both (parent steps + child ack):**
   - **Parent API** exposes composeable phases (not a buried `launch`): roughly `spawn → awaitReady → handoff → exit`.
   - **Child** must **ack** ownership (“I am ready; I own myself”) so the transfer is a real handshake on the wire, not an assumption from readiness alone.
   - Prefer reusing existing node / verify substrate for the ack; **no new control plane**. Exact verb names TBD.
7. **Ready is first-class and high-bar** (owner: “first class and top notch”) — not “port open / process alive.”
   - **Child** declares readiness through the existing **`withReadiness` / `Readiness` / node status** surface (served Hyperlinks participate; defaults ready when unset).
   - **Launcher `awaitReady`** is a **named phase** that waits until that readiness is true **and** proven cross-process (reuse `verifyConnection` / deep classify — loud failures, typed errors). No ad-hoc health hacks.
   - **Ready ≠ ownership.** Ready means “fit to serve”; **handoff ack** (locked #6) is the separate “I own myself; launcher may exit” step.
   - Quality bar: Effect-shaped API, Schema/tagged errors, no silent timeouts-as-success; composeable with Track A phases.
8. **`awaitReady` aggregation = allReady by default, configurable escape hatch.**
   - **Default:** every served Hyperlink on the node must be ready (`allReady`-shaped).
   - **Escape hatch:** caller may narrow (critical subset / Lookup-first / staged bring-up) without a second readiness system — same `withReadiness` substrate, scoped set.
9. **Ownership ack = first-class node RPC verb** (not a status-poll side effect, not a bring-up-only side channel).
   - Launcher calls it **after** Ready; child acks “I own myself; launcher may exit.”
   - Effect/Schema, loud typed failures.
   - Node status may **mirror** ownership for dashboards; the handshake is the verb.
   - Exact verb name TBD (`assume` / `acceptOwnership` / …).
10. **Module split (parent vs node):**
    - **`hyperlink-ts/Launcher`** — short-lived bring-up toolkit: `spawn` / `awaitReady` / `handoff` (+ convenience `up`).
    - **`Node`** — owns readiness surface + ownership **ack RPC** (steady-state control plane after launcher exits).
    - **CLI** (`hl` / `hyperlink` later) — thin over Launcher; not a second control plane.
    - Do **not** put OS spawn into `Node` (already transport/catalog-heavy).
11. **API names (locked):**
    - Parent: `Launcher.spawn` → `Launcher.awaitReady` → `Launcher.handoff`; convenience `Launcher.up` = compose of those then exit.
    - Node ownership RPC: **`Node.assume`** (child assumes ownership; launcher may exit).
    - Rejected names: `launch` (reads as long-lived / spine β), `release` (collides with WorkPool.release), `fork` (OS/Effect ambiguity).

Historical “Locked” rows in [`launcher-decisions.md`](./launcher-decisions.md) remain **reference only** unless re-locked here.

### Track A — baking (not locked)

- **Spawn input:** what you pass to `Launcher.spawn` / `up` (Group tree, single `Node.Tag`, entry module + identity, …).
- Failure / timeout channels for `awaitReady` and `handoff` (tagged errors; bounded wait).
- Multi-node `up`: one process vs fan-out spawn of a Group’s nodes.

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
