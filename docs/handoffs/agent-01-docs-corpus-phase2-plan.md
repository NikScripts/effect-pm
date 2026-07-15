# Agent 1 — Phase 2 plan: plans refactor

**Status:** **P1–P4 EXECUTED** (2026-07-14).  
**Assignment:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) Phase 2.  
**Branch:** `cursor/docs-corpus-phase2-plan-ce05`.

---

## Owner locks (chat 2026-07-14)

| Call | Decision |
|------|----------|
| Home | **`docs/plans/`** — delete emptied `docs/legacy/plans/` |
| Scrub | Living surfaces must **not** cite `docs/legacy/**` |
| Hybrid RuntimeStorage doc | **Archive** + drop roadmap bullet (no rewrite) |
| Host health bullet | Replace with **fleet health** (per-node readiness shipped; fleet aggregate still open) |
| Resource-RPC auth | **README-only** (no stub file) |
| Treeshaking | **Refresh** under `docs/plans/` (Effect-true module layout) |
| Non-serializable items | Move handoff → `docs/plans/` |

---

## Batches

| Batch | Status |
|-------|--------|
| **P0** inventory | done |
| **P1** scaffold `docs/plans/` + move treeshaking / weighted-middle | **done** |
| **P2** rewrite README (fleet health, auth bullet, drop Host/hybrid) | **done** |
| **P3** move `queue-nonserializable-items` | **done** |
| **P4** archive hybrid storage design | **done** → `archive/2026-07/designs/15-runtime-storage-hybrid.md` |

---

## Tree now

```
docs/plans/
  README.md
  18-unbundled-build-treeshaking.md
  weighted-middle-scheduling.md
  queue-nonserializable-items.md
```

`docs/legacy/plans/` **removed**. Citations in package TSDoc / handoffs bus point at `docs/plans/`.

---

## Next

**Pivot (2026-07-15):** **Examples book** takes priority over remaining legacy recipe ports.
See [`agent-01-examples-book.md`](./agent-01-examples-book.md).  
`toolkit-by-example` is **not** promoted to a Guides chapter.  
Legacy leftovers (processes placeholder, pointer stubs) are background. Batch Z still per-row.
