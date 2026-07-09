# Supervisor protocol

**Owner rules:**

1. **Agents show ALL work in the chat** the owner is pairing with — not file lists, not “tests pass.” Paste the actual prose, code, and command output.
2. **Supervisor coordinates via docs + git** so the owner does not relay between agents.
3. **Supervisor recaps show the work** (excerpts, outcomes), not `git diff --stat` laundry lists.

---

## What agents paste in owner chat (every slice — mandatory)

**Format: separate Before / After blocks — never unified diffs, never file lists.**

Use this template per slice:

~~~
### Slice N — [title]

**Before** (`path/to/file` or “none — new file”):

```language
…unchanged or prior content…
```

**After**:

```language
…full new content for that slice…
```

**Verify** (verbatim terminal output):

```text
…pnpm run docs:serve / typecheck / test output…
```
~~~

| Work type | Before block | After block |
|-----------|--------------|-------------|
| New file | `(none — new file)` | **Full file** |
| Edit | **Full prior section/function** | **Full new section/function** |
| Delete | **Full removed content** | `(removed)` |
| Investigation | **Current code** | **N/A — write Finding + Recommendation prose below blocks** |

**Forbidden:** `git diff`, `git diff --stat`, filename-only bullets, “updated X” without blocks.

Also update [`agent-status.md`](./agent-status.md) + session log in handoff (async).

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
