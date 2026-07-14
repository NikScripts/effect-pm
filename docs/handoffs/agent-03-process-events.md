# Agent 3 — Process live `events` stream

**Status:** **PLAN-FIRST** — supervisor assign 2026-07-14 (owner confirm failure surface).  
**Agent:** **3**  
**Branch from:** **`integration`**  
**Working branch:** `cursor/process-events-stream-a009` (new — do **not** reopen closed PR [#20](https://github.com/NikScripts/effect-pm/pull/20) tip)

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · Queue precedent: [`agent-02-queue-wire-phase-1a.md`](./agent-02-queue-wire-phase-1a.md) · event schemas: `src/internal/processEvent.ts`

**Supersedes:** closed PR #20 / deferred “Process live events” queue item. Logs P1 (followers + `persistLayer` removal) is **done** — do not reopen memo / LogStore.

---

## Why this job

Process already **persists** execution rows (`Started | Completed | Failed | Interrupted`) via `recordStore*` and exposes `run` as a typed RPC failure path (#26). It does **not** yet expose a live **`events`** stream on the handle (Queue has had this for a long time). Closed #20 waited on Queue Phase 1a + an owner failure-surface pick; Phase 1a is merged; this brief carries the recommended surface.

---

## Owner unlock (one question — recommended answer)

**Failure surface:** live **`events` + Process.store** as SSOT (same union). Poll/tick/run body failures publish `Failed` on the stream **and** write the store. **Do not** put tick failures on `start` / `stop` RPC error channels. Manual **`run`** stays the typed RPC failure path (#26).

Reply **YES** to unlock coding, or name an alternate (`store-only` / rebuild lifecycle RPC). Until YES (or alternate), Agent 3 stops after the plan.

---

## Invariant

**Persist == stream.** Every `recordStore*` emission must also land on the live PubSub (and vice versa for engine-published lifecycle facts). Do not invent a second event taxonomy.

Element schema = `makeProcessExecutionEvent(success?, error?)` already used by the store (`src/internal/processEvent.ts`). `Failed.error` is the tag’s stamped `error` schema when present, else `Schema.String` — same as today.

---

## Plan-first deliverable (stop for unlock if not already YES)

1. Restate failure surface + persist==stream in your own words.  
2. Sketch where PubSub lives (engine mirror alongside `recordStore*`), how `buildProcessSpec` gains `events: Resource.stream(...)`, and wire/`assert*` pattern if needed (mirror Queue Phase 1a — **no** unchecked `as unknown as`).  
3. Test list (local stream Started→terminal; Failed carries stamped error; store rows match stream elements; cheap remote/RPC smoke only if low-cost).  
4. Out-of-scope list (below).  
5. **Stop** until owner unlocks (or unlock is already in [`owner-decisions.md`](./owner-decisions.md)).

---

## Implementation sketch (after unlock)

| Piece | Direction |
|-------|-----------|
| Engine | Sliding/`PubSub` for execution events; publish from the same path as `recordStoreStarted` / `Completed` / `Failed` / `Interrupted` (source-buffered — no silent drops under load) |
| Spec | `events: Resource.stream(processExecutionEventSchema)` on `buildProcessSpec` / tag wire; feed tag `success`/`error` into `makeProcessExecutionEvent` like the store already does |
| Handle | Consumers: `yield* proc.events` (Queue-shaped) |
| Tests | `test/process-events*.ts` (+ `.test-d.ts` only if public type surface claims precision; avoid false `StreamElement` claims unless owner asks) |
| Changeset | Public API / behavior |
| Docs | Thin Process TSDoc + pointer; **no** `docs/site` chrome (lettered agents); leave corpus moves to Agent 1 |

---

## Out of scope

- Named queue handles / Agent D surfaces  
- Store-layer `(scopeKey, lineId)` memo (deferred)  
- Logs followers / `LogStore` / `persistLayer` (shipped)  
- `docs/site/**`, dashboard, Tailscale UX  
- Lifecycle RPC error-channel rebuild (`start`/`stop`)  
- Lineage append-reducer (backup job — only if owner parks Process)

---

## Backup (if owner parks Process)

**`Logs.withScope` append lineage reducer** — today `src/internal/logs/scope.ts` **replaces** lineage with `[tag.key]` instead of appending. That blocks real multi-segment `atRoot` / nested scopes. Plan-first small Eng; soft confirm append-only (no auto-injected node root). Ask supervisor before switching.

---

## Verification

`pnpm typecheck && pnpm test && pnpm lint` before claiming done.

---

## Short prompt (paste to Agent 3)

```
Checkout integration and pull.

Read docs/handoffs/agent-03-process-events.md.

You are Agent 3. Logs P1 is finished — do not touch LogStore / persistLayer / store-layer memo.

New job: Process live `events` stream (closed PR #20 follow-on), Queue-aligned.
Recommended unlock: failures on events + store (persist==stream); keep run as typed RPC;
do NOT rebuild start/stop RPC errors.

FIRST REPLY: plan-first only — repeat failure surface + persist==stream, sketch PubSub +
buildProcessSpec wiring + tests. Then STOP for owner unlock (unless owner-decisions already
says YES).

Out of scope: Agent D handles, docs/site, Logs followers.
Branch: cursor/process-events-stream-a009 from integration.
```
