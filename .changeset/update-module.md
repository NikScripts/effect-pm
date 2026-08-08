---
"hyperlink-ts": minor
---

**Update module** — `Update.plan` → `Update.simulate` → `Update.execute` for
ordered fleet cutovers with optional contract from→to audit. Preferred app API
over options-bag `Launcher.restartSuccessor` (`hyperlink-ts/Update`). Short
public types (`Plan`, `Step`, `Input`, `Contract`, …), fail-closed empty tags /
duplicate targets, `coUpdate` / `uncoveredCoUpdate` rollup, `liveTips` on
`UpdateImpact` for contract `from`, and `UpdateContractMismatch` (distinct from
Node verify). Also completes Tag→Service renames for Dialers + Lookup sibling
Context keys left broken after the Effect v4 mint rename.
