# Agent 1 — Phase 3 plan: legacy → live book + Draft

**Status:** **UNLOCKED** (owner “Go” 2026-07-15).  
**Assignment:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) Phase 3.  
**Branch:** `cursor/docs-corpus-phase3-ce05` off `integration`.

---

## Draft content-side convention (locked)

Site chrome / badges / `content.ts` = **lettered agents**. Agent 1 only writes **markdown**:

| Mechanism | Meaning |
|-----------|---------|
| Page block `status="draft"` | Page is not yet tip-stable SSOT (default for almost every live page today) |
| Optional `done="…"` | Space-joined checklist tokens already in use: `api` · `previews` · `types` · `verified` |
| `{.draft}` callout under H1 | **Required** on pages freshly ported from `docs/legacy/**` until a tip-check clears it |

Wording for the callout:

```djot
{.draft}
**Draft** — ported from the pre-site corpus; tip-check before treating as SSOT.
```

When tip-checked (prose + examples match tip APIs), keep or drop `status="draft"` per page maturity; remove the `{.draft}` callout; set `done=` tokens honestly. Do **not** invent CSS for Draft.

Codified in [`docs/standards/documentation.md`](../standards/documentation.md).

---

## Inventory — `docs/legacy/**` (21 files)

| Path | Role today | Live counterpart | Fate (this phase) |
|------|------------|------------------|-------------------|
| `guides/store.md` | Store consumer guide | `guides/stores.md` (**was stub**) | **Port → live**; legacy → pointer stub |
| `guides/store-backing.md` | EventJournal backing | fold into Stores | **Fold essentials → live**; legacy → pointer |
| `guides/store-migration.md` | Old tap/bridge → Store | none needed | **Archive** (migration done) |
| `STORAGE.md` | Agent persistence SSOT | standards `storage` + Stores guide | **Keep** until agents no longer cite; add consumer pointer to `/docs/stores` |
| `guides/history-and-persistence.md` | metrics+logs history narrative | Logs + Stores | **Defer** — pull leftovers after Stores/Logs tip-check |
| `guides/toolkit-by-example.md` | Pattern catalog | none | **Port next** (`guides/toolkit-by-example.md`) |
| `guides/process.md` | Process how-to | `guides/processes.md` (placeholder) | **Defer** — replace processes placeholder carefully |
| `guides/queue-resource.md` | Queue how-to | `guides/queues.md` (strong) | **Shrink** → pointer (live already ahead) |
| `guides/telemetry.md` | Telemetry | `guides/telemetry.md` | **Shrink** → pointer |
| `guides/resource-configure.md` | ResourceConfigure | `resources/configuration.md` (DynamicConfig) | **Review** — may be different surface; keep legacy until audited |
| `guides/per-resource-dependencies.md` | Per-resource deps | standards Resources | **Shrink** → pointer if covered |
| `guides/service-tags-and-runtime-split.md` | Tags / runtime split | getting-started / contracts | **Defer** |
| `guides/setup.md` | Setup | install + creating-a-resource | **Shrink** → pointer |
| `guides/beta-15-to-17.md` | Ancient migration | — | **Archive** |
| `CODEBASE-INVENTORY.md` | Stale inventory | — | **Archive** |
| `PACKAGE-GUIDE.md` | Narrative package map | index + getting-started | **Defer** (agents still open it) |
| `AGENTS.md` | Agent entry | root `AGENTS.md` → this file | **Keep** (package agents entry) |
| `PROCESS-API.md` / `RESOURCE-API.md` | Spec tables | API site + guides | **Defer** — API site is SSOT; trim later |
| `README.md` / `guides/README.md` | Indexes | — | **Rewrite** to point at live book as ports land |

**Out of scope:** Batch Z deletes (per-row owner ticks); `docs/site/**` chrome; rewriting STORAGE cutover SSOTs at handoffs root.

---

## Execution batches

| Batch | Work | Status |
|-------|------|--------|
| **P3-0** | Plan + Draft convention in Documentation standard | **this PR** |
| **P3-1** | Fill `docs/guides/stores.md`; pointer stubs for legacy store\* | **this PR** |
| **P3-2** | Port `toolkit-by-example` → live Guides + nav | next |
| **P3-3** | Replace `processes.md` placeholder from legacy process guide | next |
| **P3-4** | Pointer stubs / shrink for queue/telemetry/setup overlap | next |
| **P3-5** | Archive `beta-15-to-17` + `CODEBASE-INVENTORY` | **this PR** (safe) |
| **P3-6** | `PACKAGE-GUIDE` / API tables / STORAGE agent path | later (owner) |

---

## Verification

- No new living cites of `docs/legacy/**` (already a Phase 2 lock).
- `pnpm run docs:manifest:check` if standards change.
- Do not require `docs:serve` / Tailscale for Agent 1.
