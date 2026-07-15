# Agent 3 — Storage correctness (can’t get Store wrong)

**Status:** **SHIPPED (PR)** — [#62](https://github.com/NikScripts/effect-pm/pull/62) on `cursor/storage-correctness-all-a009`.  
**Follow-through (unlocked):** [`agent-03-storage-cutover-followthrough.md`](./agent-03-storage-cutover-followthrough.md)  
**Guide SSOT:** [`docs/guides/stores.md`](../guides/stores.md)

---

## What landed on #62

Soft-default Memory (`Store.withDefaultStorage`) — R fulfilled; AppStore override via
`Layer.provide` / `provideMerge` into the toolkit layer. Process + Queue + RunResource Soft SQLite
+ sibling-merge + Node-logs-only guards. Dual-DemoStore forms fixed.

## Agent 3 next

Take the **follow-through** brief (S1→S3). Do **not** reopen #62 API.
