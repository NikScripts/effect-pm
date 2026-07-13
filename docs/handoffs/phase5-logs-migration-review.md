# Review — PR #30 / `cursor/phase5-logs-migration-a3ad`

**Reviewed:** 2026-07-13  
**Against tip:** `9330588` (`Update legacy docs for Phase 5 Logs / Resource.logs migration`)  
**Base at review:** `integration/storage` (`d15b907`)  
**PR:** https://github.com/NikScripts/effect-pm/pull/30 — **MERGED** into `integration` (2026-07-13)

**Closeout (2026-07-14):** P0 addressed on #30; ProcessStorage / RuntimeStorage / ProcessLifecycle
substrate retired on the same tip; public `NodeLogs` shim removed on `cursor/logs-closeout-a3ad`.
**P1 still owner-gated** — do not treat the logs *platform* as closed until owner picks P1 or
explicitly parks it.

**Audience:** historical review for Agent 2; new work uses the status board + `whats-changed-2026-07-13.md`.

---

## Verdict

Treat as **merged Phase 5 consumer break**, not as “Logs platform complete.”

Core ship is real: one `Logs` module, one capture, one relay, `LogStore` on `Store.Service`, `Resource.logs`, break of `captureLogs` / handle `logs` / HistoryStore log forks, `docs/LOGS.md`, changesets.

The handoff’s **DONE (Phases 1–5)** claim overstates completeness relative to the same plan’s Phase 3–4 store-follower / level-pipe target. Platform P1 remains a separate owner call.

---

## What’s solid (keep)

| Area | Notes |
|------|-------|
| One capture | `Logs.layer` = relay + one merged capture logger |
| One persist path | `persistLayer` is a **relay subscriber** (no second logger) — `internal/logs/storeFollower.ts` |
| Lineage | `Logs.withScope` / `withLogScope` at queue/process materialize; `LogEntry.hasKey` / `atRoot` / `atLeaf` |
| Per-resource read | `Resource.logs(tag)` → `{ stream, query }`; `query` scopes via `lineageContains` |
| Breaking cleanup | `captureLogs`, spec/handle `logs`, HistoryStore `${tag.key}/logs` removed |
| Docs SSOT | `docs/LOGS.md` key catalog + migration table |
| Changesets | `logs-platform.md` (minor) + `remove-resource-logs-capture.md` (major) + `rename-store-store-api.md` |
| Store rename (bundled) | `Store.store` → `Store.scoped`; `Resource.store` → `Resource.withStore`; single-registration yield |

---

## Priority attention list

### P0 — Fix on this branch before merge (hygiene) — **DONE**

1. **Finish consumer migration off `NodeLogs` / `ProcessStorage` in first-party tree** — done on #30
2. **Remove / narrow `as unknown as LogStoreApi` casts** — done on #30
3. **CI green on the PR branch** — verified before merge
4. **Update status bus** — revisited on closeout (`agent-status.md`, `store-migration-roadmap.md`)

### P1 — Platform gaps vs your own plan (post-merge OK if owner agrees)

These are in `agent-02-logs-platform-plan.md` Phases 3–4 / §Open but **not shipped**:

| Gap | Plan intent | Current state |
|-----|-------------|-----------------|
| Resource level pipes | `logOutputLevel` / `logStreamLevel` / `logStoreLevel` / `logExportLevel` / `logLevel` | Missing on `Resource` |
| Per-registration followers | Each `Store.register` / `withStore` forks a follower; implicit `appendLog` / `logQuery` | Only node-wide `LogStore` + `persistLayer` |
| `Node.logs` on `Store.Service` | Node registration on store class | Standalone `LogStore` class instead |
| Follower memo `(scopeKey, lineId)` | Single-write per scope | Not implemented |
| `test/logs-follower.test.ts` | Conformance for match / memo / level | Missing |
| Remote `Resource.logs` | RPC `stream` + `query` on served tags | Remote path is `NodeStatus.logs` + `LogEntry.hasKey` only |
| `LogQuery` evolution | Prefer `lineageContains` / `atRoot` / `atLeaf`; retire `processId`/`queueId` | Legacy filters still primary in `byResource` |
| Child-runtime relay rule | Document inherit vs re-provide `Logs.layer` | Undocumented |

**Owner call needed:** track P1 as a follow-up PR — or park it explicitly.

### P2 — Footguns / clarity (cheap if you touch the files)

1. **`Resource.logs().stream` is unfiltered** while `query` is lineage-scoped. Docs show `Stream.filter(LogEntry.hasKey(…))`, but a bare `stream` returns the **whole node bus**. Consider either:
   - document hard in TSDoc / return a pre-filtered stream, or
   - make the handle’s `stream` always `hasKey(tag.key)` (plan said unfiltered bus + site filter; pick one and make tests assert it)

2. **`withLogExport` vs `Resource.logs`**
   - `Resource.logs(tag)` works without the pipe
   - `withLogExport` only adds `Tag.logs` via `Object.assign`
   - Confirm intended type story in `logs-resource.test-d.ts` matches runtime (pipe required for `Tag.logs` only)

---

## After merge — **status**

1. Delete `ProcessLifecycleStore` → retire substrate — **DONE** (on #30 tip / `integration`)
2. Remove public `NodeLogs` shim — **DONE** on `cursor/logs-closeout-a3ad`
3. CustomQueue / Run store cutovers (Cursor lane) — still open
4. `main` release + `pnpm run version` — still deferred

---

## Non-goals of this review

- Re-litigating owner locks already reflected in `docs/LOGS.md`
- Implementing P1 in this report commit
