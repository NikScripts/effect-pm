# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration tip:** `03737b6` — Phase 1a merged; pending merge with other integration branch

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **1** | `integration/storage` | [session-2 storage docs](./agent-01-session-2-storage-docs.md) | **merged** | Session 3 in line | typecheck + lint green | `pnpm run version` when owner ready | 2026-07-11 |
| **2** | `integration/storage` | [queue wire Phase 1a](./agent-02-queue-wire-phase-1a.md) + Session 3 consumer docs | **merged** [#21](https://github.com/NikScripts/effect-pm/pull/21) + [#17](https://github.com/NikScripts/effect-pm/pull/17) | `1aec0ff` | typecheck + 450 tests + lint green | RPC error wire deferred (owner); changeset on owner OK | 2026-07-11 |
| **B** | `action/html-doc-platform` → merged | [plan](./agent-b-plan.md) | **merged** | on integration line | islands live; docs site on merged tree | Queue handle ref follow-up | 2026-07-11 |
| **A** | `integration/rules-and-documentation` → merged | [html standards](./agent-a-html-standards-corpus.md) | **merged** | on integration line | standards corpus ch. 1–7 | — | 2026-07-11 |

---

## Supervisor queue

1. ~~Agent 1 Session 3~~ — merged on integration line
2. ~~Agent 2 Phase 1a~~ — merged [#21](https://github.com/NikScripts/effect-pm/pull/21)
3. ~~PR #17~~ — Session 3 consumer docs merged (`docs/legacy/`)
4. **Future:** merge with other integration branch (owner timeline)

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
