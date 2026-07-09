# Agent C — Standards audit (local Claude, strict)

**Status:** **BLOCKED** until Agent B ships `docs:serve` (or Agent A corpus + manifest if doing HTML-only audit first).  
**Agent:** Local Claude (**Agent C**) — trained on A+B output; **stricter than owner** in suggestions  
**Branch:** `action/standards-audit` from **`integration/storage`**

---

## Mission

Find code, docs, and examples that **break the HTML standards corpus**. Propose fixes aggressively. Owner rejects overreach — **bias toward reporting and small PRs**, not repo-wide rewrites in one pass.

---

## Behavior

| Principle | Detail |
|-----------|--------|
| **Stricter than owner** | Flag `should` as well as `must`; suggest fixes even when borderline |
| **Broad scan** | `src/`, `test/`, `examples/`, `docs/` (except `docs/handoffs/` migration archive) |
| **Evidence** | Every finding links `rule-id` from `manifest.json` + file:line |
| **Output** | `docs/site/audits/YYYY-MM-DD-report.html` + optional `fix/*` branches per subsystem |
| **No silent scope** | Chat lists every finding category and count before opening PR |

---

## Prereqs

- `docs/site/standards/manifest.json` from Agent A
- Prefer programmatic aid: ripgrep patterns derived from rules (Agent C documents patterns in audit report)

---

## Planned slices (detail when unblocked)

1. Parse manifest + build rule → regex/heuristic map
2. Scan `src/` for module-layout violations (object namespaces, `*Contract` public files, internal imports from apps)
3. Scan examples for README conventions
4. Scan docs Markdown for terms contradicted by standards HTML
5. Publish HTML audit report; open **draft** PR with **top 5** clearest fixes only (owner expands)

---

## Status

- [ ] Blocked on Agent A (minimum) / Agent B (full workflow)
