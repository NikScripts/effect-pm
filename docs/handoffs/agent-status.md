# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `e7fcd9e` — Process run RPC + effect/effectFn shape + standards corpus ([#26](https://github.com/NikScripts/effect-pm/pull/26))

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | Session 3 in line | typecheck + lint green | `pnpm run version` when owner ready | 2026-07-11 |
| **2** | `cursor/process-run-rpc-a009` → `integration/storage` | [process run RPC](./agent-02-process-run-rpc.md) | **merged** | `e7fcd9e` | typecheck + 456 tests + lint green | — | 2026-07-12 |
| **B** | `action/html-doc-platform` → merged | [plan](./agent-b-plan.md) | **merged** | on integration line | islands live; docs site on merged tree | Queue handle ref follow-up | 2026-07-11 |
| **A** | `integration/rules-and-documentation` → merged | [brief](./agent-a-rules-and-documentation.md) | **merged** | on `integration/storage` | standards corpus + manifest on integration line | — | 2026-07-12 |
| **C** | `chore/standards-audit` from `integration/storage` | [brief](./agent-c-standards-audit.md) | **step 0 done** | on `integration/storage` | docs build ✓; `docs:manifest --check` ✓ | audit catalog next (owner-gated) | 2026-07-12 |

---

## Supervisor queue

1. ~~Agent 2 Phase 1a~~ — merged [#21](https://github.com/NikScripts/effect-pm/pull/21)
2. ~~Agent 2 process run RPC~~ — merged [#26](https://github.com/NikScripts/effect-pm/pull/26) → `integration/storage`
3. ~~Standards corpus~~ — `integration/rules-and-documentation` already on integration line
4. **Owner:** close stale drafts [#17](https://github.com/NikScripts/effect-pm/pull/17), [#22](https://github.com/NikScripts/effect-pm/pull/22) (API token could not close)
5. **Optional:** `pnpm run version` when owner approves changesets

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
