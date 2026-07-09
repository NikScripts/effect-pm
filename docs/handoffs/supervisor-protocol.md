# Supervisor protocol — agent chat visibility

**Rule (owner, 2026-07-09):** Every agent posts **all work in the chat** — not just "done." The supervisor summarizes and critiques; critiques are intentionally harsh.

---

## What agents must show in chat (every session)

Post these **before** claiming a slice complete:

1. **Branch name** and `git log --oneline integration/storage..HEAD`
2. **Diff summary** — `git diff --stat origin/integration/storage...HEAD` (or per-slice stat)
3. **Verification output** — full `pnpm run typecheck` result + test summary (pass count, not "tests pass")
4. **Slice checklist** — which slices from the handoff are done vs skipped, with one-line evidence each
5. **Known gaps** — what you did *not* do and why (no silent deferrals)
6. **PR link** or explicit "PR blocked — compare URL"

Do **not** say "handoff marked complete" without the above. Do **not** stop after one slice when the handoff says five.

---

## Supervisor duties

- Merge only after chat shows evidence (or owner override)
- Summarize what actually landed vs what was claimed
- Critique gaps, shortcuts, stale docs left behind, and scope creep
- Feed the **next slice** on the same branch when session handoff is multi-slice

---

## Agent numbering (current)

| Agent | Domain | Active handoff |
|-------|--------|----------------|
| **1** | Store / queue cutover / storage docs | [`agent-01-session-2-storage-docs.md`](./agent-01-session-2-storage-docs.md) |
| **2** | Process | [`agent-02-session-2-process-platform.md`](./agent-02-session-2-process-platform.md) |

Session 1 handoffs are archived (merged). See [`reports/README.md`](./reports/README.md).
