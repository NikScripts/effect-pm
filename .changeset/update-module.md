---
"hyperlink-ts": minor
---

**Update module** — `Update.plan` → `Update.simulate` → `Update.execute` for
ordered fleet cutovers with optional contract from→to audit. Preferred app API
over options-bag `Launcher.restartSuccessor` (`hyperlink-ts/Update`). Short
public types (`Plan`, `Step`, `Input`, `Contract`, …); fail-closed empty tags /
duplicate targets / `from` with no observation; target-scoped
`migrationGaps`/`contractDrifts` so fleet order works; shared simulate/execute
gate; execute returns planned impacts; `UpdateContractMismatch` carries full
`audit` (distinct from Node verify); PascalCase audit reasons; `coUpdate` /
`uncoveredCoUpdate` rollup; `liveTips` for contract `from`. Also completes
Tag→Service renames for Dialers + Lookup sibling Context keys left broken after
the Effect v4 mint rename.
