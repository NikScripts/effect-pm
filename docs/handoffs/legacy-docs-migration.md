# Legacy docs → living book (Agent 4)

**Status:** Eng in progress (owner unlock 2026-07-28).  
**Branch:** `cursor/hyperservice-open-deps-5679`.  
**Supersedes:** leftover Phase 3 batches in [`agent-01-docs-corpus-phase3-plan.md`](./agent-01-docs-corpus-phase3-plan.md).

## Goal

Eliminate `docs/legacy/**`. Port or fold useful prose into the living book as **drafts**
(`status="draft"` + `{.draft}` when freshly ported). Organize nav around live chapters; polish to
tip-SSOT later.

## Draft convention (unchanged)

See [`docs/standards/documentation.md`](../standards/documentation.md): ported pages keep
`status="draft"` and a `{.draft}` callout under H1 until tip-check.

## Batches

| Batch | Work | Status |
|-------|------|--------|
| **L0** | Cite scrub (README, examples, PUBLISHING, root AGENTS) | **done** |
| **L1** | Delete covered guides + stub pointers (`store*`, setup, queue, telemetry, per-deps, …) | **done** (whole `docs/legacy/` removed) |
| **L2** | Fold tags-split → install; agent cutover map → stores; branch policy → root AGENTS | **done** |
| **L3** | Port `process.md` → `docs/guides/daemons.md` draft | **done** |
| **L4** | Spec tables → API site cites (PROCESS/HYPERLINK API deleted with tree) | **done** |
| **L5** | Tip-check Daemon / install / stores drafts; thicken gates if needed | open |
| **L6** | Optional: mine `toolkit-by-example` / history leftovers into examples hub | open (source deleted — recover from git if needed) |

## Living destinations

| Former legacy | Live home |
|---------------|-----------|
| `guides/process.md` | `guides/daemons.md` |
| `guides/queue-hyperlink.md` | `guides/work-pools.md` |
| `guides/setup.md` | `getting-started/install.md` + creating / managing-layers |
| `guides/telemetry.md` | `guides/telemetry.md` |
| `guides/store*.md` / `STORAGE.md` | `guides/stores.md` + `standards/storage.md` + cutover handoffs |
| `guides/service-tags-and-runtime-split.md` | `getting-started/install.md` (Tags vs runtime) |
| `guides/hyperlink-configure.md` | `work-pools.md` “Reconfiguring” (+ Daemon/Gate later) |
| `guides/per-hyperlink-dependencies.md` | `managing-layers.md` |
| `PACKAGE-GUIDE.md` / toolkit-by-example | `docs/index.md` + `docs/examples.md` |
| `PROCESS-API.md` / `HYPERLINK-API.md` | `/api/hyperlink-ts` + live guides |
| `AGENTS.md` | root `AGENTS.md` |

## Verification

- No living cites of `docs/legacy/**` (except historical handoffs / archive).
- `pnpm run docs:manifest:check` if standards change.
- Docs-only: no full typecheck required for content ports; run if Twoslash fences added later.
