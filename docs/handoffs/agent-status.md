# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `39c75d7` — integration fold complete; **next: Logs store cutover**

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | on line | typecheck + lint green | `pnpm run version` **deferred** until Logs | 2026-07-12 |
| **2** | `cursor/process-run-rpc-a009` → merged | [process run RPC](./agent-02-process-run-rpc.md) | **merged** | `e7fcd9e` | 456 tests green | — | 2026-07-12 |
| **3 (Cursor)** | `cursor/logs-store-cutover-a009` (next) | [logs store cutover](./agent-cursor-logs-store-cutover.md) | **ready-to-start** | — | — | Blocks substrate retirement + `main` release | 2026-07-12 |
| **B** | `action/html-doc-platform` → merged | [plan](./agent-b-plan.md) | **merged** | on line | doc-site live | `src/web/data.ts` SSOT follow-on | 2026-07-12 |
| **A** | `integration/rules-and-documentation` → merged | [brief](./agent-a-rules-and-documentation.md) | **merged** | on line | corpus on line | — | 2026-07-12 |
| **C** | `chore/standards-audit` | [brief](./agent-c-standards-audit.md) | **step 0 done** | on line | manifest ✓ | audit plan owner-gated | 2026-07-12 |

---

## Supervisor queue

### Active
1. **Cursor Agent 3:** [`agent-cursor-logs-store-cutover.md`](./agent-cursor-logs-store-cutover.md) — `LogStore` off `ProcessStore` facet

### After Logs
2. Delete `ProcessLifecycleStore` + retire facet substrate (Slice 3 — owner review)
3. CustomQueue store / RunResource `catchWriteErrors` (mechanical, parallel OK)
4. `src/web/data.ts` SSOT derive from `QueueHandle`

### Deferred (owner)
- **`main` merge + `pnpm run version`** — wait until Logs lands
- **Agent B:** dashboard type-safety remediation — [`agent-b-dashboard-typesafety.md`](./agent-b-dashboard-typesafety.md) (kill `data.ts` discrimination `as` casts via `kind`-guards; contain the one runtime-`R` boundary; `@since`/`@public`/suppression hygiene in `src/web`+`src/ui`). Ready to start.
- Agent C standards audit (plan-first)
- Process live `events` stream (#20)
- `Store.layerQuery` (not approved)

---

## Completed

- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- Integration fold `4c543c8` (standards/docs group)
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
