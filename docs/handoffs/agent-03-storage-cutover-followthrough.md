# Agent 3 — Storage cutover follow-through

**Status:** **PLAN-FIRST** — unlock after [#62](https://github.com/NikScripts/effect-pm/pull/62) merges (or work off that tip if owner says parallel).  
**Agent:** **3** (free; Manager owns #62 Eng).  
**Depends on:** storage correctness — toolkit `layer`/`serve` **require** `Store.Storage`; `*Memory` soft-default; guide SSOT [`docs/guides/stores.md`](../guides/stores.md).  
**Branch from:** **`integration`** (include #62). Working branch: `cursor/storage-cutover-followthrough-a009`.

**Docs bus:** [`agent-status.md`](./agent-status.md) · [`owner-decisions.md`](./owner-decisions.md) · plan [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md)

---

## Focus

Close the **consumer / parity gap** after the Storage-requirement break — examples and TSDoc still teaching “baked `layerDefaultMemory`”, and Queue/RunResource lacking the same **SQLite AppStore capture** proof Process already has.

Not a redesign. Not store memo. Not handles. Not docs-site.

---

## Why this bite

#62 fixed the engine composition model. What remains is easy to leave wrong:

1. Living TSDoc / comments still say “toolkit merges `layerDefaultMemory`; override with `provideMerge`” (phantom memory override).  
2. Process has SQLite survive-reconnect + footgun tests; **Queue / CustomQueue / RunResource** may not.  
3. Examples (`resource-web`, TUI, dashboards, forms) must compile and teach `layer` + `Layer.provide(Merge?)(AppStore)` or explicit `*Memory`.

---

## Do first

1. Read `docs/guides/stores.md` + #62 diff / description.  
2. **FIRST REPLY — tell the owner everything before code** (restate focus, inventory plan, tests, risks, out of scope). **STOP.**  
3. Implement only what the owner unlocks.

---

## Suggested eng slices (owner picks)

| Slice | Outcome |
|-------|---------|
| **S1 — Inventory + TSDoc ripple** | Grep living `src/**` + `docs/guides/**` + `README` for baked-default / override wording; fix to require-Storage + `*Memory`. No `docs/legacy/**` unless linked from living docs. |
| **S2 — Example cutover** | `examples/resource-web`, TUI, web-dashboard, forms: every toolkit `layer`/`serve` either has AppStore `provide`/`provideMerge` or uses `*Memory`. Prefer teachable recipe from stores guide. |
| **S3 — Parity tests** | Mirror `test/storage-correctness-guards.test.ts` / Process SQLite proof for **QueueResource** (and RunResource if store writes exist). Footgun: `*Memory` + private `Layer.provide(AppStore.sqlite)` leaves file empty. |

Preferred order if unlocked as one PR: **S1 → S2 → S3**.

---

## Out of scope

- Store-layer `(scopeKey, lineId)` memo  
- Agent D named handles  
- `docs/site` UI  
- Postgres  
- Re-litigating #62 API (require Storage / `*Memory`)  
- Dual-`LogRelay` hard die (Layer memo already uniques shared `Logs.layer`; docs-only)  

---

## Verify

`pnpm typecheck && pnpm test && pnpm lint`  
Changeset if public TSDoc / example-taught API narrative counts as release note (minor already landed in #62 — patch for follow-through doc-only, or none if examples/tests only).

---

## Short prompt

```
Checkout integration (after #62 merges, or include that tip). Pull.

Read:
  docs/guides/stores.md
  docs/handoffs/agent-03-storage-cutover-followthrough.md
  docs/handoffs/agent-status.md
  PR #62 description

You are Agent 3. Focus: storage-correctness follow-through —
TSDoc/example cutover + Queue/RunResource SQLite AppStore capture parity.
Memo, handles, docs-site, reopening #62 API are out of scope.

FIRST REPLY — tell the owner everything before code:
  1. Restate the Storage-require model in your own words
  2. Inventory you will search (src TSDoc, guides, examples)
  3. Which S1/S2/S3 bite you propose for THIS unlock
  4. Tests, risks, out of scope
  5. STOP for go

Branch: cursor/storage-cutover-followthrough-a009 from integration.
```
