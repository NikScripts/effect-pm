# Agent 3 — Storage correctness (can’t get Store wrong)

**Status:** **ENG** — unlocked 2026-07-15 (owner: do A→D). Branch `cursor/storage-correctness-all-a009`.  
**Agent:** Manager Eng (Agent 3 free for other lanes after this lands).  
**Plan SSOT:** [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md)  
**Guide SSOT:** [`docs/guides/stores.md`](../guides/stores.md)

---

## Focus

Make Store / Logs / `Storage` composition **fail-loud**. Silent empty journals and split-brain
(engine on `layerDefaultMemory`, app reads AppStore) are the enemy.

**Shipped shape:** toolkit `layer`/`serve`/`serveRemote` require `Storage`; `*Memory` for ephemeral;
`AppStore.layer({ filename })` requires `filename`; `_logs` tails require `LogRelay`.

---

## Out of scope

Store-layer lineId memo · Agent D handles · docs-site UI · Postgres · `layerNoop` until a concrete ambient needs it · further Process.events Eng.
