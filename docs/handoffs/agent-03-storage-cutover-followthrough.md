# Agent 3 — Storage cutover follow-through

**Status:** **UNLOCKED** — owner tasked 2026-07-15. Plan-first first reply, then eng.  
**Agent:** **3**  
**Depends on:** [#62](https://github.com/NikScripts/effect-pm/pull/62) tip (bake+override Soft). Guide SSOT [`docs/guides/stores.md`](../guides/stores.md).  
**Branch from:** **`integration`** once #62 merges — **or** tip of `cursor/storage-correctness-all-a009` if owner says parallel.  
**Working branch:** `cursor/storage-cutover-followthrough-a009`.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md)

---

## Focus

Finish **consumer cutover + remaining Soft parity** after #62. Living docs/examples must teach bake+override; CustomQueue still lacks SQLite Soft / sibling-merge proofs Process/Queue/Run already have.

Not a redesign. Not store memo. Not handles. Not docs-site. **Do not reopen #62 API.**

---

## Already done on #62 (do not redo)

- Soft-default Memory via `Store.withDefaultStorage` — R fulfilled; `*Memory` aliases  
- Process + **Queue + RunResource** Soft SQLite capture + sibling-merge empty-file guards (`test/storage-correctness-guards.test.ts`)  
- Node-logs-only Soft → engine scope unreadable (guard + stores guide note)  
- Dual-`DemoStore` process-store forms fixed  
- AGENTS persistence → `docs/guides/stores.md`; cutover-00 §2 refreshed  

---

## Why this bite (what’s left)

1. **CustomQueue** Soft SQLite + sibling-merge parity missing.  
2. Living TSDoc / plans / comments may still say “require Storage” or later-wins merge (`docs/plans/storage-correctness.md`, stray `src/**` / examples).  
3. Examples mostly compose correctly (`resource-web`, dashboards, TUI) — still teach bare `layer` vs Soft override clearly; kill any leftover dual-AppStore / wrong-order teaching.  
4. Optional (only if owner unlocks in-slice): outer `Effect.provide(Layer.mergeAll(engine, AppStore))` guard — same miss class as sibling merge.

---

## Do first

1. Read `docs/guides/stores.md` + current `test/storage-correctness-guards.test.ts` + #62 description.  
2. **FIRST REPLY — tell the owner everything before code** (restate focus, inventory, tests, risks, out of scope). **STOP.**  
3. Implement unlocked slices below.

---

## Eng slices (unlocked — prefer in order)

| Slice | Outcome |
|-------|---------|
| **S1 — Inventory + TSDoc / plan ripple** | Grep living `src/**`, `docs/guides/**`, `docs/plans/storage-correctness.md`, `README`, `examples/**` for “require Storage”, later-wins `provideMerge(AppStore, engine)`, dual-AppStore. Fix to bake+override. No `docs/legacy/**` unless AGENTS / living docs still link it. |
| **S2 — Example teachability** | Confirm `resource-web` / TUI / dashboards / forms match `stores.md`. Fix any remaining wrong compose or stale headers. Prefer one AppStore into the toolkit layer. |
| **S3 — CustomQueue Soft parity** | Mirror Queue guards in `test/storage-correctness-guards.test.ts` (or sibling file): Soft SQLite provideMerge persists + sibling `Layer.merge` leaves file empty. |

**Not unlocked unless owner says so:** fail-loud die at layer build when Soft captures a Store missing the engine registration (today: fail-soft empty journals).

---

## Out of scope

- Re-litigating #62 bake+override API  
- Store-layer `(scopeKey, lineId)` memo  
- Agent D named handles  
- `docs/site` UI / Postgres  
- Hard dual-`LogRelay` die  

---

## Done when

- S1–S3 done (or owner narrows)  
- CustomQueue Soft parity green  
- Living consumer prose matches `docs/guides/stores.md`  
- `pnpm typecheck && pnpm test && pnpm lint` green  

---

### Session log

- **2026-07-15** — Owner: “task agent 3.” Brief refreshed after #62 Soft edge-case pass (Queue/Run parity already on tip).
