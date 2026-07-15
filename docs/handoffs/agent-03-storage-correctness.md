# Agent 3 — Storage correctness (can’t get Store wrong)

**Status:** **SHIPPED (PR)** — [#62](https://github.com/NikScripts/effect-pm/pull/62) on `cursor/storage-correctness-all-a009` (Manager Eng).  
**Follow-through:** [`agent-03-storage-cutover-followthrough.md`](./agent-03-storage-cutover-followthrough.md)  
**Plan SSOT:** [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md)  
**Guide SSOT:** [`docs/guides/stores.md`](../guides/stores.md)

---

## What landed

Toolkit `layer` / `serve` / `serveRemote` soft-default `Store.layerDefaultMemory` via
`Store.withDefaultStorage` — **R is fulfilled**. Override by providing AppStore into the toolkit
layer (`Layer.provide` / `provideMerge`). `*Memory` = aliases. SQLite capture + soft-default-alone
+ sibling-merge footgun proven for Process.

## Agent 3 next

Do **not** reopen #62 API. Take the **follow-through** brief (inventory / examples / Queue parity).
