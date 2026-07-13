# Review — PR #30 / `cursor/phase5-logs-migration-a3ad`

**Reviewed:** 2026-07-13  
**Against tip:** `9330588` (`Update legacy docs for Phase 5 Logs / Resource.logs migration`)  
**Base:** `integration/storage` (`d15b907`) — branch is **0 behind / 10 ahead**, mergeable  
**PR:** https://github.com/NikScripts/effect-pm/pull/30

**Audience:** Agent 2 (and owner). Pull this file on your branch and work the open items.

---

## Verdict

Treat as **merge-ready for the Phase 5 consumer break**, not as “Logs platform complete.”

Core ship is real: one `Logs` module, one capture, one relay, `LogStore` on `Store.Service`, `Resource.logs`, break of `captureLogs` / handle `logs` / HistoryStore log forks, `docs/LOGS.md`, changesets.

The handoff’s **DONE (Phases 1–5)** claim overstates completeness relative to the same plan’s Phase 3–4 store-follower / level-pipe target. Do not close the platform workstream when #30 merges.

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

### P0 — Fix on this branch before merge (hygiene)

1. **Finish consumer migration off `NodeLogs` / `ProcessStorage` in first-party tree**
   - `examples/resource-web/server.ts` — still `NodeLogs.layer` / `persistLayer` / `byNode` / `ProcessStorage.layer`
   - `test/host-logs.test.ts`, `test/host-logs-history.test.ts`, `test/log-pipeline.test.ts`, `test/host-status.test.ts`
   - `test/fixtures/logsEnv.ts` — compose `Logs.layer` + `LogStore.layerMemory`, not `ProcessStorage.layer`
   - Stale copy: `src/internal/nodeStatusResource.ts`, `src/NodeStatus.ts` still document `NodeLogs`

2. **Remove / narrow `as unknown as LogStoreApi` casts**
   - `src/Logs.ts`, `src/store/log.ts`, `src/internal/logs/storeFollower.ts`, `src/internal/logs/resourceLogs.ts`
   - Prefer typed handle access that matches `Store.Service` single-registration yield (or a small typed adapter without cast)

3. **CI green on the PR branch**
   - No checks reported on `cursor/phase5-logs-migration-a3ad` at review time
   - Re-run and paste: `pnpm typecheck && pnpm test && pnpm lint`

4. **Update status bus**
   - `docs/handoffs/agent-status.md` still says Agent 2 plan-first
   - `docs/handoffs/store-migration-roadmap.md` still ticks Logs as plan-only
   - Align them with: Phase 5 PR open; platform follow-ups remaining (below)

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

**Owner call needed:** ship #30 as Phase 5 break now, and track P1 as a follow-up PR — or block merge until level pipes + store followers land.

### P2 — Footguns / clarity (cheap if you touch the files)

1. **`Resource.logs().stream` is unfiltered** while `query` is lineage-scoped. Docs show `Stream.filter(LogEntry.hasKey(…))`, but a bare `stream` returns the **whole node bus**. Consider either:
   - document hard in TSDoc / return a pre-filtered stream, or
   - make the handle’s `stream` always `hasKey(tag.key)` (plan said unfiltered bus + site filter; pick one and make tests assert it)

2. **`withLogExport` vs `Resource.logs`**
   - `Resource.logs(tag)` works without the pipe
   - `withLogExport` only adds `Tag.logs` via `Object.assign`
   - Confirm intended type story in `logs-resource.test-d.ts` matches runtime (pipe required for `Tag.logs` only)

3. **PR scope**
   - Title says Phase 5; commits also include Store rename + Phases 1–4
   - Fine if owner wants one merge; if not, call out dual changeset surface in the PR body (already partially done)

---

## After merge (next agent / owner queue)

1. Delete `ProcessLifecycleStore` → retire `RuntimeStorage` / `ProcessStorage` substrate (`store-migration-roadmap.md`)
2. Remove public `NodeLogs` shim when migration window ends (changeset already says one release)
3. CustomQueue / Run store cutovers (Cursor lane)
4. `main` release + `pnpm run version` — still deferred until owner says Logs follow-ups are enough

---

## Suggested Agent 2 actions on pull

```text
1. git pull origin cursor/phase5-logs-migration-a3ad
2. Read this file
3. P0 items 1–4 on this branch (migration hygiene + casts + CI + status bus)
4. Stop for owner on P1 — do not expand into store-follower / level-pipe without approval
5. Push; update PR #30 body with a short “addressed review” note listing commits
```

---

## Non-goals of this review

- Re-litigating owner locks already reflected in `docs/LOGS.md` (stream vs tail, `Logs` vs `NodeLogs`, lineage vs processId/queueId primary)
- Implementing P1 in this report commit
- Closing substrate retirement (blocked on deliberate lifecycle delete)
