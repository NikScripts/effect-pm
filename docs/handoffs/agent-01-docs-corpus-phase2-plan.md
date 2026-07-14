# Agent 1 — Phase 2 plan: plans refactor inventory

**Status:** **PLAN ONLY — awaiting owner unlock to move/delete** (2026-07-14).  
**Owner unlock trigger:** “Next” after Phase 1 A–D + Batch E design-lock landed.  
**Assignment:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) Phase 2.  
**Branch:** `cursor/docs-corpus-phase2-plan-ce05`.  
**Scope:** plan-ish docs under `docs/legacy/plans/**`, leftover handoff designs that are *future work*, and the proposed `docs/plans/` home.  
**Out of scope:** `docs/site/**` UI, Twoslash chrome, `src/web` / `src/ui`, Phase 3 legacy→book port, implementing roadmap features.

---

## Goal

One coherent place for **future / not-yet-shipped** design, separate from:

- agent briefs (`docs/handoffs/`)
- shipped guides (`docs/guides/`, `docs/legacy/guides/`, live book)
- locked historical SSOTs (stay in handoffs until Phase 3 absorbs citations)

---

## Locked posture (carried from Phase 1)

1. **Archive ≫ delete.** Deletes need per-row owner ticks (Batch Z).  
2. **When unsure → leave** and list under Deferred.  
3. **No mass moves until owner unlocks named Phase-2 batches.** This file is the inventory.

---

## Proposed home layout

```
docs/plans/
  README.md                         # living roadmap (migrate from legacy/plans/README.md)
  unbundled-build-treeshaking.md    # still actionable polish
  weighted-middle-scheduling.md     # still future product
  hybrid-storage.md                 # rewrite-or-retire (stale vs Store model)
  queue-nonserializable-items.md    # moved from handoffs (backlog feature)
  (optional) auth-for-resource-rpc.md  # only if promoted from README bullet to a spec
```

**Recommended:** introduce `docs/plans/` as the SSOT for *future* work; leave a one-line stub at `docs/legacy/plans/README.md` pointing to the new home (or redirect table in legacy AGENTS). Do **not** keep two living roadmaps.

**Rejected for now (needs owner pick):** deleting `docs/legacy/plans/` without a stub (breaks `docs/legacy/*` + `src/index.ts` citations).

---

## Proposed batches (awaiting unlock)

| Batch | What | Risk | Status |
|-------|------|------|--------|
| **P0 — this plan** | Inventory + layout proposal | None | **done in docs** |
| **P1 — scaffold `docs/plans/`** | Create README + move/copy actionable specs; stub legacy | Low | **blocked on owner** |
| **P2 — prune obsolete roadmap bullets** | Host health / RuntimeStorage hybrid / renamed terms | Low–med (accuracy) | **blocked on owner** |
| **P3 — migrate handoff backlog notes** | `queue-nonserializable-items.md` → `docs/plans/` | Low | **blocked on owner** |
| **P4 — hybrid storage rewrite-or-retire** | `15-runtime-storage-hybrid.md` vs Store cutover reality | Med | **owner call** |
| **PZ — deletes** | Remove fully superseded plan bodies after stubs | Needs ticks | **blocked** |

---

## 1. Inventory — `docs/legacy/plans/`

| Path | Role today | Tip accuracy | Proposed fate | Notes |
|------|------------|--------------|---------------|-------|
| `README.md` | Living roadmap of not-yet-shipped work | **Mixed** — several bullets shipped or outdated (Host→Node, RuntimeStorage retired) | **rewrite → `docs/plans/README.md`** | Cited by `docs/legacy/{AGENTS,PACKAGE-GUIDE,PROCESS-API,README,STORAGE}.md`, `src/index.ts` |
| `18-unbundled-build-treeshaking.md` | Unbundled/preserve-modules barrel shake | **Stale naming** (`QueueContract`, `*Namespace`) but **goal still valid** | **keep as plan** — refresh references against Effect-true module layout | Cited by toolkit-by-example |
| `weighted-middle-scheduling.md` | Weighted middle / CustomQueue-shaped scheduler | **Mostly still future**; CQR exists — re-read against tip before build | **keep as plan** | Only self-linked from README |
| `15-runtime-storage-hybrid.md` | Hybrid SQL+Redis `RuntimeStorage` | **Obsolete framing** — `RuntimeStorage` / facet substrate retired for `Store.Service` | **rewrite under Store model** **or** **archive + drop README bullet** | Owner call (batch P4) |

### Roadmap bullets in README — triage

| Bullet | Proposed |
|--------|----------|
| Guaranteed barrel-namespace tree-shaking | **keep** → points at 18 |
| Resource Host health/status | **drop or rewrite** — Node `/health` + readiness largely **shipped** |
| Resource-RPC auth | **keep** (no spec file yet) |
| Weighted middle scheduling | **keep** → weighted doc |
| Standalone spawns | **keep** (no spec) |
| Runtime identity & singleton runs | **keep** (no spec) |
| Lifecycle kernel | **keep** as exploratory (no spec) |
| Postgres backends for History/DurableQueue | **keep** — verify names vs tip stores |
| Hybrid `RuntimeStorage` | **retire or rewrite** with P4 |
| Storage-adapter integration testing | **keep** |
| Richer history vocabulary | **keep** (vague — maybe thin) |
| Metrics downsampling / multi-worker leases | **keep** |
| Re-enable `anyUnknownInErrorContext` | **keep** (hygiene) |

---

## 2. Inventory — plan-ish handoffs still at root

| Path | Role | Proposed fate |
|------|------|---------------|
| `agent-01-docs-corpus-phase1-plan.md` | Phase 1 fate table | **keep** until Phase 1 fully quiet → then archive |
| `agent-01-docs-corpus-phase2-plan.md` (this file) | Phase 2 inventory | **keep** while Phase 2 open |
| `agent-b-plan.md` | Docs app shell (lettered) | **active** — linked `docs/site/README.md`; **do not move** |
| `queue-persistence-design.md` | Locked durability decisions | **historical SSOT** — stay in handoffs (cited by `DurableQueueStore.ts` / STORAGE era). Not a *future* plan. |
| `queue-nonserializable-items.md` | Open low-priority feature TODO | **→ `docs/plans/queue-nonserializable-items.md`** on P3 unlock |
| `store-and-logs-design.md` | Early design SSOT | **historical SSOT** — stay (legacy guides cite it) |
| `store-cutover-*.md` / `*-decisions.md` | Cutover / locked decisions | **historical SSOT** — stay until Phase 3 |

Already archived this pass / earlier: Agent 3 followers + tail plans, `store-layer-query` (not approved).

---

## 3. Link-ripple check (must fix with P1 moves)

| Source | Today |
|--------|-------|
| `docs/legacy/AGENTS.md`, `PACKAGE-GUIDE.md`, `PROCESS-API.md`, `README.md`, `STORAGE.md` | `docs/plans/*.md` / `legacy/plans` |
| `src/index.ts` | TSDoc points at plans README |
| `docs/legacy/guides/toolkit-by-example.md` | treeshaking plan |
| `docs/legacy/plans/*` cross-links | internal |

Process: same PR as moves — rewrite to `docs/plans/…`, leave stub under `legacy/plans/` if wanted.

---

## 4. Out of scope (hard)

- Implementing any roadmap feature  
- Editing `docs/site/**` / widget registry / dashboard  
- Phase 3 legacy→live book + Draft badge chrome  
- Moving STORAGE-cited cutover SSOTs  

---

## 5. Open questions for owner

1. **Confirm `docs/plans/` as the new home** (vs keep under `legacy/plans/` and only rewrite)? **Recommendation: `docs/plans/`.**  
2. **Hybrid storage doc:** rewrite for `Store.Service` or archive+drop?  
3. **Host/Node health bullet:** delete from roadmap (shipped) or keep as a residual gap list?  
4. **Treeshaking plan:** refresh in place (new path) vs rewrite from scratch against current module layout?  
5. Promote **Resource-RPC auth** to its own stub file now, or leave as README-only bullet?

---

## Stop

Phase 2 = **inventory only** until you unlock P1–P4 (or edit the deferred list).

Say which Phase-2 batch to run (or “do P1–P3”).
