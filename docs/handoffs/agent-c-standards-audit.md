# Agent C — Standards audit (local Claude, strict) — **PHASE 3**

**Order:** After Agent A fills `docs/standards/`.  
**Agent:** Local Claude (**Agent C**)  
**Branch:** `chore/standards-audit` from **`integration/storage`**

**Docs bus (async):** Update [`agent-status.md`](./agent-status.md) on every push.

**Owner chat (mandatory):** Each finding as Before/After blocks per [`supervisor-protocol.md`](./supervisor-protocol.md). Paste full proposed fixes, not diff lists.

---

## Mission

Scan `src/`, `test/`, `examples/`, `docs/` against `docs/standards/manifest.json` rules. **Stricter than owner** — flag `should` and `must`. Propose fixes; owner rejects overreach.

Publish `docs/audits/YYYY-MM-DD-report.html` (served like standards). Open draft PR with **top 5** clearest fixes only.

---

## Session slices (one branch)

1. Parse manifest → rule → heuristic map; post map in chat (markdown table, not diff)
2. Scan + catalog violations — each with Before/After in chat
3. Write HTML audit report under `docs/audits/`
4. Implement top 5 fixes — each fix shown as Before/After blocks in chat
5. PR → `integration/storage`

---

## Status

- [ ] Blocked until Agent A merges standards corpus
