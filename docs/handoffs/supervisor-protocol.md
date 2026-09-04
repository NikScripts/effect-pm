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

### Changesets (mandatory owner notification)

Creating `.changeset/*.md` does **not** require owner approval. **`pnpm run version` and publish do.**

After any create/edit, paste the **full changeset file** in owner chat:

~~~
### Changeset — `.changeset/<name>.md`

**Before** (`(none — new file)` or full prior file):

```markdown
…
```

**After**:

```markdown
---
"hyperlink-ts": minor
---

Full release note body…
```
~~~

Policy SSOT: [`docs/AGENTS.md`](../AGENTS.md#changeset-policy) · branches: [`docs/AGENTS.md`](../AGENTS.md#branch-policy).

Also update [`agent-status.md`](./agent-status.md) + session log in handoff (async).

### Owner decisions (mandatory — supervisor must not be out of the loop)

When the owner steers scope, architecture, or defer/ship choices **in chat**, the agent must write it to git **on the same push** as the first code/doc that reflects it — not only in the PR body.

**Where:**

| Situation | File |
|-----------|------|
| New session / scope pivot | `docs/handoffs/agent-0N-session-M-*.md` — **§ Owner decisions** + session log |
| Cross-cutting architecture | append to [`docs/handoffs/owner-decisions.md`](./owner-decisions.md) |
| Status | [`agent-status.md`](./agent-status.md) row + supervisor queue |

**Each decision entry:**

```markdown
### YYYY-MM-DD — [topic]
- **Owner said:** (quote or tight paraphrase)
- **Chose:** A over B because …
- **Rejected:** …
- **Supervisor impact:** merge order, changeset, which agent owns follow-up
```

**Required before:** opening a PR, touching another agent's module at owner request, or declaring a prior blocker "resolved by design."

**Forbidden:** "Owner approved in chat" with no file on `integration/storage` or the agent branch; supervisor learning scope from PR description alone.

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
| **1** | [`agent-01-session-2-storage-docs.md`](archive/2026-07/agents/agent-01-session-2-storage-docs.md) |
| **2** | [`agent-02-session-2-process-platform.md`](archive/2026-07/agents/agent-02-session-2-process-platform.md) |

### Local Claude — B → A → C

**Full prompts:** [`local-agents.md`](./archive/2026-07/agents/local-agents.md)

| Phase | Agent | Handoff |
|-------|-------|---------|
| **1** | **B** | [`agent-b-html-doc-platform.md`](./archive/2026-07/agents/agent-b-html-doc-platform.md) |
| **2** | **A** | [`agent-a-html-standards-corpus.md`](./archive/2026-07/agents/agent-a-html-standards-corpus.md) |
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
