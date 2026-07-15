# Agent 3 — Storage cutover follow-through

**Status:** **PLAN-FIRST** — unlock after [#62](https://github.com/NikScripts/effect-pm/pull/62) merges (or work off that tip if owner says parallel).  
**Agent:** **3** (free; Manager owns #62 Eng).  
**Depends on:** storage correctness — toolkit soft-default Memory via `Store.withDefaultStorage` (**R fulfilled**); override with `Layer.provide`/`provideMerge(AppStore)` into the toolkit layer; guide SSOT [`docs/guides/stores.md`](../guides/stores.md).  
**Branch from:** **`integration`** (include #62). Working branch: `cursor/storage-cutover-followthrough-a009`.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · plan [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md)

---

## Focus

Close the **consumer / parity gap** after #62 bake+override — examples and leftover wording still teaching “require Storage / `*Memory` only”, and Queue/RunResource lacking the same **SQLite AppStore capture** proof Process already has.

Not a redesign. Not store memo. Not handles. Not docs-site.

---

## Why this bite

#62 fixed the engine composition model (soft-default Memory, Soft override). What remains is easy to leave wrong:

1. Living TSDoc / examples still say “toolkit **requires** Storage” or treat `*Memory` as the only soft-default.  
2. Process has soft-default-alone + SQLite provideMerge + sibling-merge footgun tests; **Queue / CustomQueue / RunResource** may not.  
3. Examples (`resource-web`, TUI, dashboards, forms) should teach bare `layer` (Memory) **or** `layer` + `Layer.provide(Merge?)(AppStore)` for durable/Logs.

---

## Do first

1. Read `docs/guides/stores.md` + #62 diff / description.  
2. **FIRST REPLY — tell the owner everything before code** (restate focus, inventory plan, tests, risks, out of scope). **STOP.**  
3. Implement only what the owner unlocks.

---

## Suggested eng slices (owner picks)

| Slice | Outcome |
|-------|---------|
| **S1 — Inventory + TSDoc ripple** | Grep living `src/**` + `docs/guides/**` + `README` for “require Storage” / wrong override wording; fix to bake+override. No `docs/legacy/**` unless linked from living docs. |
| **S2 — Example cutover** | `examples/resource-web`, TUI, web-dashboard, forms: teach soft-default Memory and AppStore override via `provide`/`provideMerge` into the toolkit layer (not sibling merge). |
| **S3 — Parity tests** | Mirror `test/storage-correctness-guards.test.ts` for **QueueResource** (and RunResource if store writes exist). Footgun: sibling `Layer.merge(engine, AppStore.sqlite)` leaves file empty. |

Preferred order if unlocked as one PR: **S1 → S2 → S3**.

---

## Out of scope

- Store-layer `(scopeKey, lineId)` memo  
- Agent D named handles  
- `docs/site` UI  
- Postgres  
- Re-litigating #62 bake+override API  
- Dual-`LogRelay` hard die (Layer memo already uniques shared `Logs.layer`; docs-only)  

---

## Done when

- Living consumer docs / examples match `docs/guides/stores.md`
- Queue (and RunResource if applicable) have SQLite capture + sibling-merge footgun parity with Process
- `pnpm typecheck && pnpm test && pnpm lint` green on the follow-through branch
