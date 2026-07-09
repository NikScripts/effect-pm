# Supervisor protocol

**Owner rules:**

1. **Agents show ALL work in the chat** the owner is pairing with — not file lists, not “tests pass.” Paste the actual prose, code, and command output.
2. **Supervisor coordinates via docs + git** so the owner does not relay between agents.
3. **Supervisor recaps show the work** (excerpts, outcomes), not `git diff --stat` laundry lists.

---

## What agents paste in chat (every slice — mandatory)

When you finish a slice, paste **the work itself**:

| Work type | Paste this |
|-----------|------------|
| **Docs rewrite** | The full new section(s) — not “updated STORAGE.md” |
| **New code** | Full file or full changed functions |
| **Tests** | Full new test cases + verbatim `pnpm test` / vitest output |
| **Investigation** | Conclusion + quoted code from repo proving it |
| **Blocked** | Exact reason + the code path you traced |

**Forbidden as slice output:** `git diff --stat`, bullet lists of filenames only, “handoff marked complete” with no content.

Also update [`agent-status.md`](./agent-status.md) (one row) and append **Session log** in your handoff — that is for supervisor/async, not a substitute for chat.

---

## Supervisor duties

1. Read `agent-status.md`, handoffs, git — **without owner relay**
2. Recap for owner using **substantive excerpts** of what landed
3. Verify typecheck/tests on branch tip before merge
4. Mean critique: claimed vs actual work
5. Merge when green; write next handoff

---

## Agent roster

### Cursor Cloud

| Agent | Handoff |
|-------|---------|
| **1** | [`agent-01-session-2-storage-docs.md`](./agent-01-session-2-storage-docs.md) |
| **2** | [`agent-02-session-2-process-platform.md`](./agent-02-session-2-process-platform.md) |

### Local Claude — B → A → C

| Phase | Agent | Handoff |
|-------|-------|---------|
| **1** | **B** | [`agent-b-html-doc-platform.md`](./agent-b-html-doc-platform.md) |
| **2** | **A** | [`agent-a-html-standards-corpus.md`](./agent-a-html-standards-corpus.md) |
| **3** | **C** | [`agent-c-standards-audit.md`](./agent-c-standards-audit.md) |

Index: [`reports/README.md`](./reports/README.md) · dashboard: [`agent-status.md`](./agent-status.md)

---

## Session log template (handoff file — async)

```markdown
### Session log YYYY-MM-DD HH:MM UTC
- **Branch:** @ `sha`
- **Slices done:** …
- **Verification:** …
- **Gaps:** …
```

Chat gets the **full work**; session log gets the **pointer**.
