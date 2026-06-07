# 22 — Effect ecosystem adapters (SQL, Workflow, Cluster)

**Status:** Design / roadmap. Optional peer-dependency integration layers — core
`effect-pm` stays in-process and storage-facet based.

**Related:** [STORAGE.md](../STORAGE.md), [15-runtime-storage-hybrid.md](./15-runtime-storage-hybrid.md),
[telemetry-split-bake.md](../recipes/telemetry-split-bake.md), [21-state-vocabulary.md](./21-state-vocabulary.md).

---

## One sentence

Use **`@effect/sql`** as the native durable substrate for our storage adapters and
optional durability layers; use **`@effect/workflow`** and **`@effect/cluster`** as
**optional compose-time adapters** that wrap our semantic APIs — not replacements
for `Process`, `QueueResource`, or facet archive.

---

## `@effect/sql` — what it is

| Module | Role |
| --- | --- |
| **`SqlClient`** | Connection, transactions, reactive queries, dialect helpers |
| **`Statement`** | Tagged-template SQL with bound parameters (no string concat) |
| **`SqlSchema`** | One-shot encode/decode around queries (`single`, `findAll`, `void`, …) |
| **`SqlResolver`** | Batched / deduped / transactional request resolvers (`ordered`, `grouped`, `findById`, `void`) |
| **`Model`** | Schema-first row traits + CRUD resolver factories |
| **`Migrator`** | Versioned migrations (`fromFileSystem`, `fromRecord`) |
| **`SqlPersistedQueue`** | Durable work queue with lease/lock semantics (operational queue, not archive) |
| **Driver packages** | `@effect/sql-sqlite-node`, `@effect/sql-pg`, … |

We already depend on **`@effect/sql-sqlite-node`** for the shipped SQLite
`RuntimeStorage` adapter (`storage/sqlite`). Imports currently go through
`effect/unstable/sql/*` — track Effect v4 stable paths when they land.

---

## Relevance to `effect-pm` (by subsystem)

### 1. `RuntimeStorage` adapters (high — already started)

**Today:** SQLite adapter uses `SqlClient` + hand-rolled DDL (`CREATE IF NOT EXISTS`),
manual row codec, and a whitelist predicate compiler in `storage/sqlite/service.ts`.

**SQL toolkit wins:**

- **`Migrator`** — replace ad hoc DDL bootstrap with versioned migrations (needed
  before hybrid storage and column additions like `instanceId`).
- **`Statement` + `SqlSchema`** — typed insert/select for `RuntimeRecord` rows;
  shrink manual encode/decode in `codec.ts`.
- **`SqlClient.withTransaction`** — honest `RuntimeStorage.transaction` for hybrid
  policy + rate-limit windows (plan 13).
- **`Model`** — optional: define `RuntimeRecordRow` once if we want generated
  CRUD resolvers; not required if `RuntimeRecord` stays generic.

**Prisma adapter stays** for apps already on Prisma. New internal work should
prefer `@effect/sql` drivers; Prisma is a consumer-supplied structural client, not
our default substrate.

### 2. Store facet spine (medium)

Facets talk to `ProcessStoreSpine`, not SQL directly — **keep that boundary**.

SQL improvements belong **inside** `RuntimeStorage` implementations:

- **`SqlResolver.ordered`** for `createBatch` ordering / dedup at the adapter.
- **`SqlResolver.grouped`** if facet reads get N+1 hot paths (future optimization).

Do not expose `SqlClient` on public facet tags.

### 3. Archive vs operational queue (critical distinction)

| Concern | Our model | Effect SQL helper |
| --- | --- | --- |
| **Historical facts / analytics** | `RuntimeStorage` + store facets (`queue.entry.*`, …) | Row storage via `SqlSchema` / `Model` |
| **Durable work handoff** | Not shipped; plan 03 remote handoff | **`SqlPersistedQueue`** |
| **Workflow step queue** | Optional workflow adapter | **`DurableQueue`** + SQL backing |

**Do not** conflate facet archive rows with `SqlPersistedQueue`. Archive is
append/query semantics; persisted queue is lease, retry, and completion semantics.

### 4. Workflow adapters (high — owner requested)

Optional public subpaths (peer deps: `@effect/workflow`, `@effect/sql`):

| Adapter | Wraps | Substrate |
| --- | --- | --- |
| **`Process.fromWorkflow`** | User `Workflow` registration + execute | `WorkflowEngine` layer (often SQL-backed) |
| **`RunResource.fromWorkflow`** | Gate/run lifecycle as workflow activities | Same |
| **`QueueResource.fromWorkflow`** | Enqueue/dequeue as durable activities | `DurableQueue` / `SqlPersistedQueue` |
| **`Telemetry.operation.asActivity`** | Tracked ops map to `Activity` pattern internally | Workflow engine persistence |

Core kernels stay pure Effect. Adapters translate between our scopes/telemetry
and workflow execution ids.

### 5. Cluster adapters (medium — after workflow)

Optional peer `@effect/cluster`:

| Adapter | Use |
| --- | --- |
| **`ProcessGroup.withSharding`** | Distributed process ownership |
| **`QueueResource.withEntity`** | Sharded queue workers |
| **`ProcessSchedule.withClusterCron`** | Cluster-wide cron instead of local supervisor |
| **SQL-backed `MessageStorage`** | Multi-node message durability |

Cluster is **distribution**, not durability. Pair with SQL or workflow engine
for honest cross-node recovery.

### 6. Hybrid storage (plan 15)

Hybrid adapter = one `RuntimeStorage` tag routing internally:

- **SQL backend** — `@effect/sql` client (sqlite/pg)
- **Redis backend** — existing `storage/redis` shape

Facets unchanged.

---

## Adoption order (recommended)

1. **SQLite adapter hardening** — `Migrator` + `SqlSchema` for `RuntimeRecord` (no public API change).
2. **Telemetry + store split** — finish bake; implement `Telemetry.Tag` + `Store.Tag` (blocks honest emit/archive).
3. **Effect RPC store transport** — replace custom store wire (plan 16); SQL unchanged on archive path.
4. **Workflow adapter package slice** — `Process.fromWorkflow`, `RunResource.fromWorkflow` as optional layer.
5. **Queue durable handoff** — `SqlPersistedQueue` or workflow `DurableQueue` behind `QueueResource` adapter (plan 03).
6. **Hybrid `RuntimeStorage`** — plan 15 after migrations + `transaction` are solid.
7. **Cluster adapters** — after single-node workflow path is proven.

---

## Non-goals

- Replacing `RuntimeStorage` facet model with `Model` CRUD per domain table.
- Making `@effect/workflow` or `@effect/cluster` required core dependencies.
- Using `SqlPersistedQueue` as the queue **archive** (wrong semantics).
- Exposing raw `SqlClient` on `ProcessStore` / facet public tags.

---

## Verification

Each adapter slice:

```bash
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```

Optional peer packages: separate test project or tagged vitest suite with peer
installed; core CI stays green without peers.
