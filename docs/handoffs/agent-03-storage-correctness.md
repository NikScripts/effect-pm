# Agent 3 — Storage correctness (can’t get Store wrong)

**Status:** **PLAN-FIRST** — owner focus 2026-07-14.  
**Agent:** **3** (free after [#59](https://github.com/NikScripts/effect-pm/pull/59)).  
**Plan SSOT:** [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md)  
**Branch from:** **`integration`**. Working branches per unlocked slice: `cursor/storage-correctness-a-a009` / `-b-…`.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · [`docs/standards/storage.md`](../standards/storage.md) · [`docs/guides/stores.md`](../guides/stores.md) (placeholder today)

---

## Focus

Make Store / Logs / `Storage` composition **fail-loud**. Silent empty journals and split-brain (engine on `layerDefaultMemory`, app reads AppStore) are the enemy.

This **absorbs** the thin “child-runtime `Logs.layer` inherit” idea into Phase C of the plan (one bake-in per Node runtime).

---

## Do first

1. Read the plan end-to-end.  
2. **FIRST REPLY:** tell the owner everything (restate thesis, P0/P1, A vs B bite, tests, risks). **STOP.**  
3. Implement only the phase(s) the owner unlocks.

---

## Out of scope

Store-layer lineId memo · Agent D handles · docs-site UI · Postgres · `layerNoop` until a concrete ambient needs it · further Process.events Eng.

---

## Short prompt

See bottom of [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md).
