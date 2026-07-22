# Storage correctness — you can’t get it wrong

**Status:** **Soft stack SHIPPED** on `integration` — bake+override [#62](https://github.com/NikScripts/effect-pm/pull/62) + follow-through S1–S3 [#65](https://github.com/NikScripts/effect-pm/pull/65) (living prose + CustomQueue Soft SQLite / sibling-merge parity). Agent 3 Soft **idle**.  
**SSOT (wiring):** [`docs/guides/stores.md`](../guides/stores.md) — toolkit soft-default Memory (R fulfilled); override by providing AppStore **into** the toolkit layer (`Layer.provide` / `provideMerge`). `*Memory` = aliases.  
**Not this plan:** Agent D handles; docs-site chrome; Postgres. Soft fail-loud **Eng’d** 2026-07-21. Store-layer `(scopeKey, lineId)` memo **Eng’d** same wave (seed claim from `_logs` at tail acquire).

---

## Thesis

Apps “get storage wrong” when wiring **typechecks and runs but records/reads the wrong journal** (or none). Fail-fast exists for **duplicate scope keys** and **unregistered engine scopes**. Missing Soft override (sibling `Layer.merge` of engine + AppStore) still yields **silent empty** AppStore files — document + guard, don’t teach it.

Goal: happy path is **one recipe** (`stores.md`); intentional multi-node / two-copy logs stay allowed.

---

## What already ships (#62 + #65 — do not redo)

| Defense | Where |
|---------|--------|
| Soft-default Memory via `Store.withDefaultStorage` — R fulfilled; `*Memory` aliases | Process / Queue / CustomQueue / RunHyperlink toolkit layers |
| Soft SQLite capture + sibling-merge empty-file guards | `test/storage-correctness-guards.test.ts` (Process, Queue, RunHyperlink, CustomQueue) |
| Node-logs-only Soft → layer build dies (`resolveOrDie`) | same guards + stores guide note |
| Dual-`DemoStore` process-store forms fixed | `examples/forms/process-store/*` |
| Living Soft teachability (examples + TSDoc ripple) | #65 S1–S2 |
| AGENTS persistence → stores guide; cutover-00 §2 refreshed | repo tip |
| `Store.Service.layerMemory` / `layer` bake `Logs.layer` + per-registration `_logs` tails | `src/Store.ts` |
| Private `_logs` / full-key `Logs.byHyperlink` | #57 / #59 |

**Intentionally allowed**

- One `Store.Service` per Node: many registrations, one journal/file.  
- Multi-node: N stores / N runtimes (`resource-web`).  
- Node journal + resource `_logs` copies of the same live line.  
- `Store.layerDefaultMemory` for engine event observability **without** the Logs platform.  
- `DurableQueueStore` / `ShardMap` / `HistoryStore(metrics)` as separate planes.

---

## Recipe (Effect-true) — copy from stores guide

```ts
// Soft unwrap sees AppStore.Storage — engines write that journal.
Process.layer(Daily, { effect: poll }).pipe(
  Layer.provideMerge(AppStore.layer({ filename: ".hyperlink-ts/data.sqlite" })),
)

// httpServer — Layer.provide is fine when you do not yield* AppStore in-process:
Hyperlink.wsServer([Process.serve(Daily, { effect: poll })]).pipe(
  Layer.provide(AppStore.layer({ filename })),
  …
)
```

**Do not** sibling-`Layer.merge(engineLayer, AppStore.layer…)` and expect Soft override — Soft never sees ambient `Storage`; engines stay on default Memory; AppStore file stays empty.

**Do not** Soft-override with a Node-logs-only `Store.Service` unless that store also registers the engines you run.

There is no “later-wins Soft override.” Soft peeks ambient `Storage` **at toolkit layer build**. Providing AppStore into the toolkit layer is the override; merge order of unrelated services is ordinary Effect layering.

---

## Footgun ranking (post Soft stack)

| # | Footgun | Today | Defense |
|---|---------|-------|---------|
| **P0** | Sibling `Layer.merge(engine, AppStore)` expecting Soft override | Silent empty SQLite | stores guide + Soft guards (Process/Queue/Run/CustomQueue) |
| **P1** | Expect logs from `layerDefaultMemory` alone | Empty `by*` / `Hyperlink.logs` | stores guide + TSDoc |
| **P1** | Soft-override with store that omits engine registration | Layer build dies (`resolveOrDie`) | **Eng’d** — Process/Queue/CustomQueue/Run probe at build |
| **P1** | Missing `Node.logs` / toolkit `.store(tag)` | Empty durable queries | docs / empty-query honesty |
| **P2** | Nested / second `Logs.layer` or second `Store.Service` in one Node | Two buses/journals | Document-only (Phase C) |
| **P3** | Legacy bag / `processId` identity docs | Confusion | mostly fixed (#59); Agent 1 archive if leftovers |
| **—** | Store-layer lineId memo | **Eng’d** — seed claim from `_logs` at acquire | rematerialize / restart safe |

---

## Phased plan

### Phase A — Recipe SSOT · **DONE (#62)**

`docs/guides/stores.md` filled; README/examples aligned for Soft; AGENTS → stores guide.

### Phase B — Hard guards · **DONE Soft surface (#62 + #65)**; fail-loud **Eng’d**

| Guard | Status |
|-------|--------|
| Soft unwrap + Memory soft-default | **Shipped** (#62) |
| Soft SQLite + sibling-merge tests (Process/Queue/Run/CustomQueue) | **Shipped** (#62 + #65) |
| Fail-loud when Soft captures store lacking engine registration | **Eng’d** (2026-07-21) — `resolveOrDie` at toolkit layer build |
| Outer `Effect.provide(Layer.mergeAll(engine, AppStore))` guard | Guide-only unless unlocked |
| B2 LogRelay presence / B3 filename honesty / B4 registration completeness | Owner unlock later |

### Phase C — One bus / one journal per Node · document-first

Still owner-gated for refuse-second-relay Eng.

### Phase D — Query key hygiene · small

Optional warn when key is not in the registration set; Agent 1 can own archive doc leftovers.

---

## Agent 3 follow-through · **DONE (#65)**

1. **S1** — Living prose: kill “require Storage” / later-wins Soft / dual-AppStore teaching; point at bake+override.  
2. **S2** — Examples teach Soft override clearly (`resource-web`, TUI, forms).  
3. **S3** — CustomQueue Soft SQLite provideMerge + sibling-merge empty-file guards.

Out of scope (still): reopen #62 API; memo; handles; docs-site; Postgres; fail-loud Soft die.

---

## Success criteria

An app author who follows `guides/stores.md` cannot accidentally leave engines on soft-default Memory while reading AppStore **when they used the documented provide-into recipe**. Sibling-merge footgun remains documented + tested (empty AppStore file).

Verification: `pnpm typecheck && pnpm test && pnpm lint` + Soft guards named for the footgun.
