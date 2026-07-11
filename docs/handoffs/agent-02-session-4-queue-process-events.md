# Agent 2 — Session 4: Queue wire erase + Process live `events`

**Agent:** Process / Queue platform (Agent 2)  
**Base:** `integration/storage` @ `2bab35b`  
**Branches (draft PRs — not merged):**

| PR | Branch | Tip (local) | Title |
|----|--------|-------------|-------|
| [#19](https://github.com/NikScripts/effect-pm/pull/19) | `cursor/queue-spec-wire-a009` | `00ad80f` | Queue Phase 1 — typed `events` RPC wire |
| [#20](https://github.com/NikScripts/effect-pm/pull/20) | `cursor/process-events-stream-a009` | `ba427d8` | Process live `events` stream |

**Docs bus:** [`agent-status.md`](./agent-status.md) updated on push. **Supervisor:** merge PRs in order (#19 → #20 recommended), then run verification on `integration/storage`.

---

## Shipped this session

### Queue Phase 1 (`cursor/queue-spec-wire-a009`)

- `queueSpec(item, success?, error?)` forwards tag wire schemas into `buildQueueEvent` (was always `Unknown`/`Unknown`).
- `QueueResource.Tag` passes `config.success` / `config.error` into `queueSpec`.
- `layer` / `serve` / `buildQueueImpl` infer `Success` + `Error` from tag spec.
- Tests: `test/queue-success-value.test.ts`, `.test-d.ts` (`StreamElement` on `events`).
- Docs: `docs/guides/queue-resource.md` — live wire typed; store tier-1 erase noted as Phase 2.

### Process live `events` (`cursor/process-events-stream-a009`)

- `buildProcessSpec(success?, error?)` adds `events: Resource.stream(...)` from `makeProcessExecutionEvent`.
- `Process.Tag` passes `success` / `error` into `buildProcessSpec`.
- Engine: `PubSub` fan-out at run boundaries; `persistExecutionEvent` publishes live + store on `layer` / `serve`.
- **Resolves Session 2 RPC blocker by design:** failures on **`events` stream**, not void lifecycle RPC `error` (aligned with Queue).
- Tests: `test/process-events-stream.test.ts`, `.test-d.ts`.
- Docs: `docs/PROCESS-API.md`, `docs/guides/process.md` (this push).

**Verification (both branches):** `pnpm run typecheck` ✅ · `pnpm test` ✅ (440 tests, 99 files).

---

## Still needs doing (manager queue)

### Merge / release (owner)

| # | Action | Owner |
|---|--------|-------|
| 1 | Review + merge **PR #19** → `integration/storage` | Supervisor |
| 2 | Rebase **PR #20** on post-#19 `integration/storage`, merge | Supervisor |
| 3 | **Changeset** for public API/behavior (both PRs) — `pnpm run version` when approved | Owner |
| 4 | CHANGELOG / release notes (docs-release agent) | After changeset |

### Platform follow-ups (not in these PRs)

| Item | Priority | Notes |
|------|----------|-------|
| **Queue store Phase 2** | Medium | Tier-1 `record` / `events` still schema-erased at store facet; analytics reads typed. `internal/store/queueStoreSpec.ts`. |
| **Process store Phase 2** | Medium | Same pattern as queue — `ProcessEventOf` erased at tier-1. |
| **Store module naming / layout** | Low | `facetStore` → `registerResourceStore`; split legacy `spine` from Store bridge; see owner chat 2026-07-11. No bundled facet registry — confirmed. |
| **`STORAGE.md` deep pass** | Agent 1 | Out of scope Agent 2 |
| **Consumer docs PR #17** | Check | Session 3 `process-consumer-docs` — confirm merged or still open |

### Explicitly closed / deferred

| Item | Resolution |
|------|------------|
| Void-RPC `error` on Process `start` / `stop` / `runImmediately` | **Deferred** — use live `events` + store `Failed.error` |
| Per-tag `processSpec` rebuild for RPC failure responses | **Not needed** given events-stream model |
| Single registry of all store facets | **Never existed** — apps compose `Store.Service` + `*.store(tag)` per resource |

---

## Architecture note (for supervisor)

```text
Queue / Process failure visibility:
  live:  yield* Tag → .events stream (Failed.error / Failed.cause typed from tag)
  store: yield* Tag.store → events() / analytics (same union; tier-1 types still erased — Phase 2)
  NOT:   void lifecycle RPC error channel
```

---

## Session log

### 2026-07-11 — Docs + manager handoff

- Consumer docs updated for Process live `events` and Queue wire (guides + PROCESS-API).
- Agent report + status board updated with open PRs and remaining-work table.
- Pushed `cursor/process-events-stream-a009`; agent-status synced on queue branch where applicable.
