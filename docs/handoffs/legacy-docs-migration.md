# Legacy docs → living book (Agent 4)

**Status:** Gap recovery Eng’d (2026-07-28); IA / sidebar still owner-open.  
**Branch:** `cursor/hyperservice-open-deps-5679`.  
**Related:** Examples book SSOT-include (E1b) — see [`agent-01-examples-book.md`](./agent-01-examples-book.md).  
**Supersedes:** leftover Phase 3 batches in [`agent-01-docs-corpus-phase3-plan.md`](./agent-01-docs-corpus-phase3-plan.md).

## Goal

Eliminate `docs/legacy/**`. Port or fold useful prose into the living book as **drafts**.
Organize nav around live chapters; polish to tip-SSOT later. **Sidebar / folder IA still
needs an owner design pass** (agent jumped ahead once — do not restructure further without lock).

## Draft convention (unchanged)

See [`docs/standards/documentation.md`](../standards/documentation.md): ported pages keep
`status="draft"` and a `{.draft}` callout under H1 until tip-check.

## Batches

| Batch | Work | Status |
|-------|------|--------|
| **L0** | Cite scrub (README, examples, PUBLISHING, root AGENTS) | **done** |
| **L1** | Delete `docs/legacy/**` | **done** |
| **L2** | Fold tags-split → install; branch policy → root AGENTS | **done** |
| **L3** | Port `process.md` → `docs/guides/daemons.md` draft | **done** |
| **L4** | Spec tables → API site cites | **done** |
| **L4b** | Gap recovery after audit | **done** — see below |
| **L5** | Tip-check Daemon / install / stores / work-pools drafts | **partial** — install cleared draft; tip API fixes on daemons/stores/work-pools (still `status=draft`) |
| **L6** | Owner IA lock (sidebar + folder tree) before more moves | **open** |
| **L7** | Optional: mine toolkit-by-example from git history | open |

## Gap recovery (L4b) — what landed where

| Lost unique content | Living destination |
|---------------------|--------------------|
| WorkPool analytics table + Soft store recipe | `docs/guides/work-pools.md` § Persistence and analytics |
| `DurableWorkPoolStore` recipe | `work-pools.md` + tip `stores.md` §2 (renamed from DurableQueueStore) |
| `HistoryStore` enable for `metrics.query` | `stores.md` § History + `work-pools.md` |
| Tailwind `@source` / `theme.css` / symptom map | `docs/observe/dashboard.md` § Styling |
| Configure = layer patch once at build (not hot reload) | `work-pools.md` Reconfiguring; cross-links on Daemon / Gate |
| Agent cutover pointer | `stores.md` § Cutover history |
| Branch policy / repo map | root `AGENTS.md` |

Recover further leftovers from `git show 5fef620e^:docs/legacy/…` if needed.

## Living destinations (original map)

| Former legacy | Live home |
|---------------|-----------|
| `guides/process.md` | `guides/daemons.md` |
| `guides/queue-hyperlink.md` | `guides/work-pools.md` |
| `guides/setup.md` | `getting-started/install.md` + creating / managing-layers + **dashboard Tailwind** |
| `guides/telemetry.md` | `guides/telemetry.md` |
| `guides/store*.md` / `STORAGE.md` | `guides/stores.md` + `standards/storage.md` + cutover handoffs |
| `guides/service-tags-and-runtime-split.md` | `getting-started/install.md` (Tags vs runtime) |
| `guides/hyperlink-configure.md` | work-pools / daemons / gates configure sections |
| `guides/per-hyperlink-dependencies.md` | `managing-layers.md` |
| `PACKAGE-GUIDE.md` / toolkit-by-example | `docs/index.md` + `docs/examples.md` |
| `PROCESS-API.md` / `HYPERLINK-API.md` | `/api/hyperlink-ts` + live guides |
| `AGENTS.md` | root `AGENTS.md` |

## Verification

- No living cites of `docs/legacy/**` (except historical handoffs / archive).
- `pnpm run docs:manifest:check` if standards change.
