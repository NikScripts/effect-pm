---
"hyperlink-ts": minor
---

**Update module** — `Update.plan` → `Update.simulate` → `Update.execute` for
ordered fleet cutovers with optional contract from→to audit. Preferred app API
over options-bag `Launcher.restartSuccessor` (`hyperlink-ts/Update`). Short
public types (`Plan`, `Step`, `Input`, `Contract`, `PlanError`,
`ValidateError`, …); fail-closed empty tags / empty targets / blank tag keys /
duplicate targets / duplicate contracts / `from` with no observation;
target-scoped `migrationGaps`/`contractDrifts` so fleet order works; shared
simulate/execute gate re-derives blockers from impact arrays (forged
`blocked: false` refused) and re-validates plan shape; execute returns planned
impacts and forwards only `prefer`; `UpdateContractMismatch` carries full
`audit` (distinct from Node verify); PascalCase audit reasons; `Report` tagged
`UpdateReport`; `update.*` spans/log spans; `coUpdate` / `uncoveredCoUpdate`
rollup; `liveTips` for contract `from`.

**Node.shutdown leave:** unregister Directory first; clear Advice only when the
dial-matched row was removed and prefer still points at the departing
`nodeKey` — so `Advice.prefer(B)` / same-identity cutovers survive A's leave
(was blanketing every served key).

Also completes Tag→Service renames for Dialers + Lookup sibling Context keys
left broken after the Effect v4 mint rename.
