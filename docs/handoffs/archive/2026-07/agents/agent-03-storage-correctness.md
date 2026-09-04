# Agent 3 — Storage correctness (can’t get Store wrong)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

**Status:** **CLOSED** — Soft stack on `integration`: [#62](https://github.com/NikScripts/effect-pm/pull/62) bake+override + [#65](https://github.com/NikScripts/effect-pm/pull/65) follow-through S1–S3.  
**Follow-through brief:** [`agent-03-storage-cutover-followthrough.md`](./agent-03-storage-cutover-followthrough.md) (**CLOSED**)  
**Guide SSOT:** [`docs/guides/stores.md`](../../../../guides/stores.md)  
**Living plan:** [`docs/plans/storage-correctness.md`](../../../../plans/storage-correctness.md)

---

## What landed

### #62 — Soft bake+override

Soft-default Memory (`Store.withDefaultStorage`) — R fulfilled; AppStore override via
`Layer.provide` / `provideMerge` into the toolkit layer. Daemon + WorkPool + Gate Soft SQLite
+ sibling-merge + Node-logs-only guards. Dual-DemoStore forms fixed.

### #65 — Follow-through S1–S3

Living Soft prose/examples + untyped WorkPool Soft SQLite / sibling-merge parity.

## Still parked

Fail-loud Soft die · store memo · Phase C dual-`Logs` refuse · Postgres · handles / site.
Do **not** reopen Soft bake+override API without owner unlock.
