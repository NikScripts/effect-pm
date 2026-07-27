# Agent 3 — `Logs.byResource` full scope-tag key

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

**Status:** **IN FLIGHT** — Eng on `cursor/logs-byresource-full-key-a009` (owner go 2026-07-14).  
**Agent:** **3**  
**Branch from:** **`integration`** tip (after [#57](https://github.com/NikScripts/effect-pm/pull/57) — private `_logs`).  
**Working branch:** `cursor/logs-byresource-full-key-a009`

**Owner locks (confirmed):** full key / tag; hard-break bag; kill resource-identity `processId`/`queueId` names (keep RPC `groupId`); no legacy storage fallback; classify via `Hyperlink.kindOf`.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · [`docs/LOGS.md`](../LOGS.md) · [`docs/guides/logs.md`](../guides/logs.md)

---

## Why this job

Product durable/live export already takes a **scope tag** (`Hyperlink.logs(Tag)` → `Tag.key`).  
`Logs.byResource` still takes a fake Daemon/Queue bag:

```ts
Logs.byResource({ processId?: string; queueId?: string }, opts?)
// really: pick one string → queryDurableScope(key)
```

Owner lock: **scope identity = full key** (the registration / `Tag.key`, e.g. `wnba/LiveScorePoller`) — pass the **scope tag** (or its `.key`), not `processId` vs `queueId` costumes.

**Related (already shipping / shipped in #57):** the platform journal shape is private `_logs` (Effect-style underscore). Apps may own a shape named `log`. Do **not** document `handle.log` / `handle._logs` as product API. Reads = `Hyperlink.logs` / `Logs.byNode` / `Logs.byResource`.

---

## Owner locks (already)

| Decision | Lock |
|----------|------|
| Scope identity | **Full key** = scope tag’s `.key` (same string as store registration / lineage segment) |
| Preferred product export | `Hyperlink.logs(tag)` stays canonical for live + durable |
| Platform journal name | `_logs` private (#57) — apps free to use shape name `log` |
| Store-layer `(scopeKey, lineId)` memo | Still **deferred** |
| Named handles / docs-site | Out of scope (D / lettered) |

---

## Still open (ask in plan; recommend answers)

1. **Breaking API:** hard-remove `{ processId?, queueId? }` now (still beta.28), **or** one-release deprecated overload?  
   - **Recommend:** hard-break — beta, surface is thin.
2. **Signature:** `byResource(tag, opts?)` where `tag` has `.key`, **plus** optional `byResource(key: string, opts?)`?  
   - **Recommend:** tag-first overload + string full-key overload (mirror `byNode`).
3. **CLI / `LogQuery` / `logScope`:** switch match to `LogEntry.hasKey(fullKey)` / prefer `lineageContains` in the **same** PR?  
   - **Recommend:** yes for `logEntryMatchesScope`; keep legacy annotation match as fallback only if needed for ancient rows (`LogEntry.lineage` already falls back).
4. **Engine dual-stamp** of `processId`/`queueId` annotations?  
   - **Recommend:** leave writes alone this slice.

---

## Plan-first (FIRST REPLY — tell the owner everything, then STOP)

1. Restate: bag vs tag/full-key; how `byResource` relates to `Hyperlink.logs().query` and private `_logs`.  
2. Proposed public signatures + migration of call sites (`docs/LOGS.md`, `docs/guides/logs.md`, `examples/hyperlink-web`, tests).  
3. CLI/`LogQuery` slice: in or out this PR.  
4. Tests + changeset (+ `.test-d.ts` for public type).  
5. Out of scope list.  
6. **Stop** until owner says **go** (and confirms 1–4).

Do **not** implement until unlocked.

---

## Implementation sketch (after go)

| Piece | Direction |
|-------|-----------|
| `src/Logs.ts` | `byResource(tag \| string, opts?)` → `queryDurableScope(key)`; delete bag (or deprecate per unlock) |
| Types | Reuse / align with `StoreScopeTag` / `ResourceLogKey` as today |
| CLI | `logScope` / `logEntryMatchesScope` → `hasKey` on resolved full key |
| Docs | Update LOGS + guides; drop bag examples |
| Tests | Call-site migrate; type-level assert bag gone / tag ok |
| Changeset | Public API break (minor/major per project habit for beta) |

---

## Out of scope

- Store-layer memo · Agent D handles · `docs/site` · Logs followers redesign · renaming `_logs` again · Daemon.events further Eng · `layerNoop`

---

## Verification

`pnpm typecheck && pnpm test && pnpm lint` before claiming done.

---

## Short prompt (paste to Agent 3)

```
Checkout integration and pull (merge/ff #57 private `_logs` if not on tip yet).

Read docs/handoffs/agent-03-byhyperlink-full-key.md.

You are Agent 3. Prior tracks done (events, lineage, ready-perfection). Do not reopen memo / handles / site.

New job: reshape Logs.byResource so scope identity is a full key / scope tag
(same as Hyperlink.logs(Tag).key) — drop the processId|queueId bag.

Owner lock: full key. Platform journal is private `_logs` (#57).

FIRST REPLY — tell the owner everything before any code:
  1. Restate job + how byResource vs Hyperlink.logs vs `_logs` fit
  2. Proposed signatures + hard-break vs deprecate
  3. Whether CLI/LogQuery is in this PR
  4. Tests, docs, changeset, risks, out of scope
  5. STOP — wait for go

Branch: cursor/logs-byresource-full-key-a009 from integration.
```
