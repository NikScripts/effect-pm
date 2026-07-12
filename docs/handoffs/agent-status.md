# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `f2353c5` — handoffs closed; integration fold at `4c543c8`

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | on line | typecheck + lint green | `pnpm run version` when owner ready | 2026-07-11 |
| **2** | `cursor/process-run-rpc-a009` → merged | [process run RPC](./agent-02-process-run-rpc.md) | **merged** | `e7fcd9e` in [#26](https://github.com/NikScripts/effect-pm/pull/26) | 456 tests green | — | 2026-07-12 |
| **B** | `action/html-doc-platform` → merged | [plan](./agent-b-plan.md) | **merged** | on line | doc-site islands live | `src/web/data.ts` SSOT follow-up | 2026-07-12 |
| **A** | `integration/rules-and-documentation` → merged | [brief](./agent-a-rules-and-documentation.md) | **merged** | `4c543c8` | corpus + intro on line | — | 2026-07-12 |
| **C** | `chore/standards-audit` | [brief](./agent-c-standards-audit.md) | **step 0 done** | on line | `docs:manifest:check` ✓ (104 rules) | **Plan-first** — audit catalog owner-gated | 2026-07-12 |

---

## Supervisor queue (next priorities)

### 1 — Release path (owner)
- Merge `integration/storage` → `main` (+2 linguist commits on `main` only)
- `pnpm run version` — many queued changesets (Process run RPC, observability rename, store/tag wire, …)

### 2 — Store migration ([`store-migration-roadmap.md`](./store-migration-roadmap.md))
- **Claude (local):** Logs facet → delete `ProcessLifecycleStore` → retire facet substrate
- **Cursor (cloud):** CustomQueue built-in store (Process ✅, Run partial, Queue ✅)

### 3 — Hygiene
- Re-run [`branch-cleanup-manifest.md`](./branch-cleanup-manifest.md) on current tip
- `src/web/data.ts` — derive `QueueService` from `QueueHandle` (post #23 handle ref fix)

### 4 — Owner-gated / deferred
- **Agent B:** dashboard type-safety remediation — [`agent-b-dashboard-typesafety.md`](./agent-b-dashboard-typesafety.md) (kill `data.ts` discrimination `as` casts via `kind`-guards; contain the one runtime-`R` boundary; `@since`/`@public`/suppression hygiene in `src/web`+`src/ui`). Ready to start.
- Agent C standards audit (plan → catalog → top-5 fixes)
- Process live `events` stream (#20)
- `Store.layerQuery` (not approved)

---

## Completed this integration fold

- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn shape
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) Queue handle ref + node status ref + positional tag schemas
- Standards corpus (A) + manifest tooling (C) + intro rewrite (B path)
- Stale drafts [#17](https://github.com/NikScripts/effect-pm/pull/17), [#22](https://github.com/NikScripts/effect-pm/pull/22) closed

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
