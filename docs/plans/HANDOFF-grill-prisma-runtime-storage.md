# Handoff: grill session → Prisma `RuntimeStorage` adapter

**Purpose:** Starter context plus a **copy-paste prompt** for a high-capability agent to run a **grill-me** planning session until the **`RuntimeStorage`** Prisma implementation is explicit enough for a **cheaper builder agent**.

**In scope:** `@nikscripts/effect-pm/prisma`, structural `PrismaClient` delegate types, **`RuntimeRecord`** persistence, parity with **`RuntimeStorage.memory`** / **SQLite** semantics, migrations and tests inside this repo.

**Out of scope:** WOW app code, dashboard UI, React, tRPC routers, **`ControlPlanePort`**, gateway topology, or any consumer-specific wiring. The maintainer owns that track; **this artifact exists so the adapter is ready before WOW implementation.**

**Suggested baseline:** Branch from **`main`** after storage alias work merges, or merge **`origin/cursor/process-storage-aliases-158c`** first so builders inherit **`ProcessStorage.*`** facets — see [`STORAGE.md`](../STORAGE.md).

---

## Prompt — paste into the planning agent’s first message

You are the **lead planner** for the **Prisma-backed `RuntimeStorage` adapter** in **`@nikscripts/effect-pm`** (this repository only).

Your job is to **grill decisions** until we have **one actionable implementation plan**: phased work, acceptance criteria (including **SQLite / in-memory parity**), explicit **non-goals**, and a checklist for a **cheaper coding agent**.

### How to run the session

1. Open and follow **`.cursor/skills/grill-me/SKILL.md`**, except use **topical rounds** instead of strictly one question per turn. Each assistant message bundles **2–5 tightly coupled decisions**. After each round, print **Resolved / Deferred / Blocked** with one line each on **why**.
2. Before asking repository facts, **read or search this repo**. Prioritize:
   - [`docs/STORAGE.md`](../STORAGE.md) — facets, `RuntimeRecord`, wire types
   - [`src/RuntimeStorage.ts`](../../src/RuntimeStorage.ts) — `RuntimeStorageService`, tagged errors, `selectRuntimeRecords` / `applyRuntimeRecordPatch` (semantic reference helpers)
   - [`src/storage/sqlite/index.ts`](../../src/storage/sqlite/index.ts) — **parity contract** documented in package TSDoc; reference implementation behaviour
   - [`src/prisma/PrismaProcessStore.ts`](../../src/prisma/PrismaProcessStore.ts), [`src/prisma/types.ts`](../../src/prisma/types.ts), [`src/prisma/index.ts`](../../src/prisma/index.ts), [`src/storage/prisma.ts`](../../src/storage/prisma.ts)
   - [`test/prisma-*.test.ts`](../../test/) — current fail-fast / setup expectations
3. **Deliverables** when grilling is complete:
   - **Prisma schema sketch** (table name(s), columns for indexed fields vs JSON blobs, uniqueness on `id`, indexes for facet query patterns). **Schema lives in the consumer (WOW)**; document what **effect-pm** expects from the generated **delegate shape** (`PrismaProcessStoreClient` or renamed service).
   - **Structural client interface**: minimal methods the adapter calls (mirror current pattern — **optional peer `@prisma/client`**, **no importing generated client in this package** unless policy changes).
   - **Semantics matrix**: row-for-row parity with **`RuntimeStorage.memory`** / SQLite adapter for **`create` / `read` / `upsert` / `update` / `delete`** including **readonly** and **duplicate id** rules.
   - **Query strategy**: map `RuntimeRecordQuery` predicates to SQL (or deliberate interim “load and filter” with perf caveats vs SQLite reference).
   - **Layer surface**: revive **`prismaClientLayer({ client })`**, **`layer` / `layerFromContext`** to provide **`RuntimeStorage`** successfully (today they **die** with `PrismaProcessStoreUnavailableError`).
   - **Date/time**: `occurredAt` / `createdAt` as **`DateTime.Utc`** in-domain — storage boundary serialization to Prisma **`Date`** (or string) explicitly decided.
   - **Transactional story**: batch writes from facets vs explicit `$transaction` — what the adapter guarantees.
   - **Migration from legacy `EffectPmEvent`**: explicitly **no** revival of append-only legacy table; **`types.ts`** legacy rows are documentation / structural placeholders until removed or trimmed.
   - **Testing**: structural mocks vs test DB; which scenarios mirror [`test/`](../../test/) SQLite runtime suites.
   - **Release hygiene**: reminder that shipping public adapter behaviour warrants a **changeset** (`@nikscripts/effect-pm`).

### Constraints (verify in code; do not assume)

- **`RuntimeStorageService`** exposes only **`RuntimeStorageDuplicateRecordError`** and **`RuntimeStorageReadonlyRecordError`** — adapters must not leak other typed failures on the documented port unless you explicitly extend the contract (discuss tradeoffs).
- **SQLite adapter** documents matching **`RuntimeStorage.memory`**; Prisma adapter should aim for the **same behavioural contract** for v1 unless a deviation is justified and documented.
- **Injected client**: callers pass an already constructed **`PrismaClient`** from their app (**WOW** owns generation and migrations).

### Topical rounds the session must cover

| Round | Objective |
| ----- | ----------- |
| A — Goals | v1 adapter “done means …”, perf expectations, explicit non-goals (no WOW, no dashboard). |
| B — Schema | Table shape, indexes, uniqueness, JSON columns, WOW-owned migration path. |
| C — Structural types | Delegate interface rename (`effectPmEvent` → `runtimeRecord` or similar); optional peer versioning. |
| D — Predicate → storage | Efficient SQL vs parity-first “load/filter”; limits on `take`/`skip` equivalents. |
| E — Layers & lifecycle | Scoped resources, `$disconnect` ownership (app vs adapter). |
| F — Errors & defects | SQL errors: map, die, or extend tagged errors consistently with SQLite notes. |
| G — Verification | Test plan, parity checklist vs memory/SQLite, CI commands from **`docs/AGENTS.md`**. |

Close with an **`Implementation handoff appendix`** — ordered bullets the builder executes.

---

## Appendix: shortcut facts for planners

| Topic | Detail |
| ----- | ------ |
| Contract | [`RuntimeStorageService`](../../src/RuntimeStorage.ts): `create`, `read`, `upsert`, `update`, `delete`. |
| Row shape | [`RuntimeRecord`](../../src/RuntimeStorage.ts): `id`, `type`, timestamps, `runId`, `processType`, `processId`, optional facets, `indexA-H`, `payload`, `attributes`, `readonly`. |
| Reference adapter | **`@nikscripts/effect-pm/storage/sqlite`** module doc + `RuntimeStorage.memory`. |
| Placeholder today | **`PrismaProcessStore.ts`**: **`layer`** / **`layerFromContext`** **`Effect.die`** with **`PrismaProcessStoreUnavailableError`** until real implementation. |
| Types today | **`PrismaProcessStoreClient`** still exposes legacy **`effectPmEvent`** delegate — needs replacement for **`RuntimeRecord`** CRUD/queries. |

---

## After grilling

1. Capture the approved plan in a new **`docs/plans/*.md`** or extend this file — **human-approved** wording before build.
2. Builder opens a **`cursor/`** branch from **`main`** (or agreed baseline).
3. Run **`pnpm typecheck && pnpm test && pnpm run lint && pnpm run build`** when touching runtime code (**`docs/AGENTS.md`**).

