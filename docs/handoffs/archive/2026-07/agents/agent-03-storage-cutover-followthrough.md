# Agent 3 — Storage cutover follow-through

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

**Status:** **CLOSED** — S1–S3 shipped via [#65](https://github.com/NikScripts/effect-pm/pull/65) onto `integration` (after Soft bake+override [#62](https://github.com/NikScripts/effect-pm/pull/62)).  
**Agent:** **3** (idle on Soft)  
**Guide SSOT:** [`docs/guides/stores.md`](../../../../guides/stores.md)

**Docs bus:** [`agent-status.md`](../../../agent-status.md) · [`owner-decisions.md`](../../../owner-decisions.md)

---

## Focus (done)

Finish **consumer cutover + remaining Soft parity** after #62. Living docs/examples teach bake+override; untyped WorkPool has Soft SQLite / sibling-merge proofs matching Daemon/Queue/Run.

Not a redesign. Not store memo. Not handles. Not docs-site. **Do not reopen #62 API.**

---

## Shipped

### On #62 (Soft bake+override)

- Soft-default Memory via `Store.withDefaultStorage` — R fulfilled; `*Memory` aliases  
- Daemon + WorkPool + Gate Soft SQLite capture + sibling-merge empty-file guards (`test/storage-correctness-guards.test.ts`)  
- Node-logs-only Soft → engine scope unreadable (guard + stores guide note)  
- Dual-`DemoStore` process-store forms fixed  
- AGENTS persistence → `docs/guides/stores.md`; cutover-00 §2 refreshed  

### On #65 (S1–S3 follow-through)

| Slice | Outcome |
|-------|---------|
| **S1** | Living prose / TSDoc / plan ripple → bake+override (no “require Storage” / later-wins Soft) |
| **S2** | Example Soft teach headers (`hyperlink-web`, TUI, custom-queue form) match `stores.md` |
| **S3** | untyped WorkPool Soft SQLite `provideMerge` + sibling-merge empty-file guards |

---

## Still parked (not this brief)

- Fail-loud Soft die when AppStore lacks engine registration (today: fail-soft empty journals)  
- Outer `Effect.provide(Layer.mergeAll(engine, AppStore))` guard — same miss class as sibling merge (guide-only unless owner unlocks)  
- Store-layer `(scopeKey, lineId)` memo · Agent D handles · `docs/site` / Postgres · hard dual-`LogRelay` die  

---

### Session log

- **2026-07-15** — Owner: “task agent 3.” Brief refreshed after #62 Soft edge-case pass (Queue/Run parity already on tip).
- **2026-07-15** — Owner: **go**. Branched from #62 tip. S1 plan/TSDoc/later-wins Soft wording; S2 example Soft headers (resource-web, TUI, custom-queue form); S3 untyped WorkPool Soft SQLite + sibling-merge guards (10 Soft tests green).
- **2026-07-15** — Soft stack landed: #62 then #65 merged to `integration`; Agent 3 Soft **idle**. Status/plan prose flipped CLOSED in hygiene pass.
