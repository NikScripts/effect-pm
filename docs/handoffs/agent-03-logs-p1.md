# Agent 3 — Logs store followers (owner intent — REPEAT BACK FIRST)

**Status:** **CLOSED** — Eng track complete on `integration`.  
**Shipped:** followers [#40](https://github.com/NikScripts/effect-pm/pull/40) · `persistLayer`/`LogStore` hard-remove [#43](https://github.com/NikScripts/effect-pm/pull/43) · lineage append [#48](https://github.com/NikScripts/effect-pm/pull/48).  
**Also shipped (same Agent 3 session):** Process live `events` [#47](https://github.com/NikScripts/effect-pm/pull/47) + remote proof [#51](https://github.com/NikScripts/effect-pm/pull/51).  
**Deferred (parked):** store-layer `(scopeKey, lineId)` memo.  
**Do not reopen** for Eng unless owner unlocks a new slice. Superseded plan PRs [#35](https://github.com/NikScripts/effect-pm/pull/35)/[#46](https://github.com/NikScripts/effect-pm/pull/46) closed; branches deleted.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`agent-03-logs-store-followers-plan.md`](./agent-03-logs-store-followers-plan.md) · [`docs/LOGS.md`](../LOGS.md) · optional guide [#50](https://github.com/NikScripts/effect-pm/pull/50)

---

## Your first message (mandatory)

Before any plan options, checklist inventiveness, or code: **repeat the owner model back in your own words.**

Paste something like:

> ### Repeat-back — store followers
> 1. Capture …
> 2. Relay …
> 3. Store …
> 4. What Agent 2 left unfinished …
> 5. What I must build …

**Then stop.** Do not implement. Do not propose alternate write policies that undo this model. Wait for the owner to say the repeat-back is correct.

If you cannot restate it without hedging into “B1 node-primary forever,” you have not understood the job.

---

## What the owner wanted (locked)

This is **not** optional, and it is **not** “keep `Logs.persistLayer` + standalone `LogStore` and call it done.”

### One capture, many tails, store writes via **followers on registrations**

```
 runtime root (node)                         resource fibers
        │                                           │
        ▼                                           ▼
  Logs.layer  (ONE capture Logger)           Logs.withScope(tag)  → lineage
        │                                           │
        └──────────────► LogRelay (PubSub + tail) ◄─┘
                              │
                              ├─ live tails (NodeStatus.logs / Resource.logs.stream + hasKey)
                              │
                              └─ STORE FOLLOWERS (this is the product job)
                                    │
                         each Store.register / *.store(tag) / Node.logs
                         forks a follower on the relay that:
                           1. gates with logStoreLevel for that registration
                           2. matches rows with LogEntry.hasKey(scopeKey)
                              (node registration matches everything / atRoot)
                           3. memo (scopeKey, lineId) — no double-append for that scope
                           4. appends via implicit appendLog on the registration
```

**Design rules (owner-locked):**

1. **Capture once** at the node — `Logs.layer`. Never a second logger for durability.
2. **Live** and **durable** are different channels. Levels gate them separately (`logStreamLevel` vs `logStoreLevel`).
3. **Durable storage follows the bus** — subscribers (“followers”) on `LogRelay`, owned by **store registrations**, not by a one-off `persistLayer` side channel forever.
4. **Implicit store shapes** on registrations: `appendLog` + `logQuery` (see Agent 2 plan). Toolkit `QueueResource.store(tag)` / `Process.store(tag)` / node registration gain these; engines do not invent their own log tables.
5. **Node-wide bucket** is also a registration — sketch `Node.logs` / `Logs.registerNode` on a `Store.Service` — same follower factory as resource scopes. `groupId` / bucket = node key.
6. **Single durable append per (scope, line)** via memo. Do not invent two writers that both persist the same scoped line. Prefer clear primary: registrations that are active followers write for their scope; do not stack a separate global `LogStore` *and* every resource registration writing duplicates.

Canonical sources:

- [`agent-02-logs-platform-plan.md`](./agent-02-logs-platform-plan.md) — **Store integration** + Phase 3–4
- [`store-and-logs-design.md`](./store-and-logs-design.md) — **Single capture, single store write** (overrides table in Agent 2 plan wins on naming; the follower diagram is still the intent)

### What “`LogStore`” was doing in the interim

`LogStore` (`@nikscripts/effect-pm/store/Log`) is the **interim node journal sink** Agent 2 left behind after migrating the old facet off `ProcessStore`. It is **not** the end-state product API the owner asked for.

End state: durability hangs off **`Store.Service` registrations** (node + resources) with a shared follower factory — not “apps must remember `Logs.persistLayer(node)` + compose a special `LogStore` class forever” as the story.

Agent 2’s `internal/logs/storeFollower.ts` is the **seed** of that factory (subscribe → batch → append). It is currently wired **only** as `Logs.persistLayer(node)` → standalone `LogStore`. **That wiring is incomplete relative to the locked model.** Your job is to finish the model, not to defend the interim as final.

---

## What Agent 2 actually shipped (so you are not confused)

| Piece | Done? | Notes |
|-------|-------|--------|
| One capture + `LogRelay` | **Yes** | `Logs.layer` |
| Lineage via `withScope` | **Partial** | Engines stamp; reducer depth may still be thin |
| Remove `captureLogs` / handle `logs` | **Yes** | Phase 5 |
| Remove `NodeLogs` | **Yes** | #33 |
| Node-wide follower → `LogStore` | **Yes — interim only** | `Logs.persistLayer` → `storeFollower.ts` |
| Per-registration followers | **No** | **This is the missing job** |
| Implicit `appendLog` / `logQuery` on `*.store(tag)` | **No** | |
| `Node.logs` registration replacing special-case `LogStore` story | **No** | |
| Level pipes (`logStoreLevel` / `logStreamLevel` / …) | **No** | |
| Follower memo conformance tests | **No** | |
| Remote first-class `Resource.logs` | **No** | Dashboard filters `NodeStatus.logs` today |

**Do not** “re-do Phase 5.” **Do** finish store followers + the registration shape. Levels and remote can be ordered by the owner **after** you correctly restate the store model — but do not invent a “B1 keep node-primary forever” escape that abandons registration followers unless the owner explicitly says so in this session.

---

## Failed previous Agent 3 brief (superseded)

An earlier `agent-03-logs-p1.md` framed write policy as **open menu B1/B2/B3** and suggested “smallest P1 = keep one writer.” That framing **misled** you: it treated Agent 2’s unfinished interim as an owner-approved permanent design.

**This document supersedes that.** The owner’s intended write model is **registration followers** (plan B2 / design-doc follower diagram). Node registration is part of that model — not a substitute that cancels resource followers by default.

If the owner later picks “node-journal only, query filters for resources,” that will be an **explicit unlock**. Until then, plan and build toward registration-native followers.

---

## After repeat-back is accepted — plan rules

1. Describe how you will turn `storeFollower.ts` into the **shared factory** used by node + each scope registration.  
2. Describe where `appendLog` / `logQuery` appear on contracts and how `LogStore` / `persistLayer` shrink or become thin wrappers.  
3. State the single-write / memo rule and the tests you will add (`test/logs-follower.test.ts`).  
4. Level pipes and remote logs: list as ordered follow-ups; **do not** expand into them until the owner unlocks that slice.  
5. Stop for unlock before code.

---

## Rules

- Branch from **`integration`**.  
- No named-handles work (Agent D).  
- No resurrecting `captureLogs`, spec `logs`, `NodeLogs`, or ProcessStorage.  
- No `as any` / `as unknown as`.  
- `pnpm typecheck && pnpm test && pnpm lint` before claiming done.  
- Changeset for public API / behavior.

---

## Short prompt (paste to Agent 3)

```
Checkout integration and pull:
  git fetch origin integration && git checkout integration && git pull

Read docs/handoffs/agent-03-logs-p1.md carefully.

You are Agent 3. Agent 2 shipped capture + relay + an interim node-wide
Logs.persistLayer → LogStore follower. That is NOT the finished product.

The owner wanted STORE FOLLOWERS on Store registrations:
  - one capture (Logs.layer)
  - LogRelay bus
  - each Store.register / *.store(tag) / Node.logs forks a follower
  - match LogEntry.hasKey(scopeKey), logStoreLevel gate, memo (scopeKey, lineId)
  - implicit appendLog + logQuery on those registrations

FIRST REPLY: repeat that model back in your own words (capture, relay, store,
what is interim vs end-state, what you must build). Then STOP.
Do not write code. Do not propose keeping "node LogStore only" as the end state
unless you are quoting an owner unlock.
```
