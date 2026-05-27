# Handoff: grill session → WOW dashboard integration plan

**Purpose:** Starter context + **copy-paste prompt** for a high-capability (“pricey”) agent to run a **grill-me** planning session until the development plan is explicit enough for a **cheaper builder agent**.

**Suggested implementation baseline:** Branch **from `origin/cursor/process-storage-aliases-158c`** (`feat(ProcessStorage): facet class aliases under ProcessStorage.*`) so builders inherit shortened `ProcessStorage.*` facet imports. Optionally merge that branch to `main` first per repo policy.

**Related optional context (may differ from `main`):** Branch `origin/cursor/dashboard-prep-docs-158c` has extended guides (`dashboard-integration`, `service-tags-and-runtime-split`, topology notes). Grill agent should reconcile with **current `main`** when writing the final plan.

---

## Prompt — paste into the planning agent's first message

You are the **lead planner** for **`@nikscripts/effect-pm` + WOW** (WOW = the consumer monorepo: **Prisma + tRPC**; WOW is **not** in this repository).

Your job is to **grill decisions** until we have a **single actionable development plan** (phased work, acceptance criteria, explicit **out of scope** for v1, and a handoff checklist for a **cheaper implementation agent**).

### How to run the session (optimized grill-me)

1. Open and follow **`/workspace/.cursor/skills/grill-me/SKILL.md`**, except:
   - Use **topical rounds** instead of enforcing one trivial question per turn. Each message should bundle **2–5 tightly coupled decisions**.
   - After each round, print **Resolved / Deferred / Blocked** with one line each on **why**.
2. Before asking about repo facts, **read or search this repo**. Prioritize:
   - `docs/STORAGE.md`
   - `docs/guides/control-plane.md`
   - `docs/guides/dashboard-integration.md` (if present on your checkout; else see branch note above)
   - `docs/guides/service-tags-and-runtime-split.md` (same)
   - `src/ProcessStorage.ts`
   - `src/ControlTransportHttp.ts` or `ControlService` module (listen/bind)
   - `src/prisma/PrismaProcessStore.ts`, `src/prisma/types.ts` (placeholder + `prismaClientLayer`)
3. **Deliverables** when grilling is complete:
   - A **numbered phase plan** (effect-pm vs WOW), each phase with **exit criteria**.
   - A **thin API contract**: `ControlPlanePort` methods + canonical **WOW tRPC duck shape** (procedure names vs monolithic mutation).
   - **Storage/logs strategy**: where `RuntimeStorage` runs, whether WOW reads via **shared Prisma DB** vs **PM-hosted read HTTP**, SQLite vs Postgres stance.
   - **Security placeholder** explicit for Tailscale-only phase vs later droplets.
   - **Changeset policy** (when public `exports` / peers change).
   - **Git instruction** for the builder: branch from **`origin/cursor/process-storage-aliases-158c`** (or `main` if merged).

### Product context (verify; do not trust blindly)

- **Controls** go through **`ControlService`** (HTTP, `127.0.0.1` today) behind a **same-origin gateway** (WOW tRPC procedures `fetch` private PM URL).
- **Widgets** depend only on **`ControlPlanePort`** + React context; **fetch** and **tRPC adapters** live in orthogonal entry points; **optional** peers for `@trpc/client`.
- **Tags vs runtime split:** service-class **tags** modules must stay **bundler-safe** versus **`Layer`/SQLite/PM runtime** modules (`docs/guides/service-tags-and-runtime-split.md`).
- **ProcessStorage:** combined `Layer`s **and** facet class aliases — `ProcessStorage.QueueResource` is the **storage facet**, not `@nikscripts/effect-pm/QueueResource` worker.
- **Prisma:** future **`RuntimeStorage`** adapter should take an **existing** `PrismaClient` (**`prismaClientLayer({ client })`** / `PrismaClientService` pattern exists as placeholder awaiting real delegate types for **`RuntimeRecord`** rows).
- **Priorities:** **working dashboard first**; home server deploy; **Tailscale** containment; **real auth / droplets** later.

### Branches topical rounds must cover

| Round | Objective |
| --- | --- |
| A — Goals | v1 UX, explicit non-goals, “done means …” |
| B — Topology | Gateway URLs, Compose/Tailscale, PM ↔ WOW boundaries |
| C — `@nikscripts/effect-pm/react` | Surface area, peers, adapter entrypoints, versioning |
| D — WOW tRPC | Router layout, mirrors `ControlPlanePort`, SSR/mobile |
| E — Storage/logs | Postgres via Prisma vs PM SQLite; read path; facet queries exposed how |
| F — Prisma adapter | Schema ownership in WOW, structural delegates, transaction story |
| G — Example in effect-pm | Vite/demo scope vs maintenance burden |
| H — QA | Tests, smoke checklist, rollout order |

Close with **`Implementation handoff appendix`** bullets the cheap agent executes in order.

---

## Appendix: facts for planners (shortcut)

| Topic | Detail |
| --- | --- |
| Control HTTP | Routes in `docs/guides/control-plane.md`; responses `ControlResponse`. |
| Storage rules | Single source: `docs/STORAGE.md`; facets under `src/store/*`; **`Effect.serviceOption` reads**. |
| Prisma stub | `PrismaProcessStoreUnavailableError` until `RuntimeStorage` Prisma lands; **`prismaClientLayer`** wraps injected client today. |

---

## After grilling

1. Paste the **final plan** into a new **`docs/plans/*.md`** (or update this file’s sibling) — **human-approved** wording.
2. Open a **`cursor/`** implementation branch per **baseline** instructions above.
3. Run **`pnpm typecheck && pnpm test && pnpm run lint && pnpm run build`** when touching **`effect-pm`** runtime code (**`docs/AGENTS.md`**).
