# 16 — Storage adapter integration testing

**Status:** Agreed direction (May 2026). Complements shipped conformance
tests and [15-runtime-storage-hybrid.md](./15-runtime-storage-hybrid.md).

---

## Problem

Today most durable adapters are validated with **in-process doubles**:

| Adapter | Default test |
|---------|----------------|
| Memory | Native `Map` |
| SQLite | Real `better-sqlite3` (`:memory:` / temp file) |
| Prisma | Structural in-memory `PrismaRuntimeStorageClient` mock |
| Redis | `makeInMemoryRedisSend` |

Conformance suites (`describeRuntimeStorageContract`) give strong **semantic**
parity. They do **not** prove wire protocol, driver quirks, Lua/MULTI, or
cross-connection persistence.

High-fidelity mocks (especially Prisma query emulation) grow almost as complex
as the adapter they stand in for, while still missing failure modes.

---

## Tiered strategy

| Tier | Command | Purpose |
|------|---------|---------|
| **1 — Contract** | `pnpm test` | Shared conformance + fast doubles; **required on every PR** |
| **2 — Integration** | `pnpm test:integration` (TBD) | Real services where semantics matter |
| **3 — Manual** | `docker compose` + env URL | Local debugging, reproducing production issues |

**Rule:** Tier 1 stays zero external services. Tier 2 is opt-in (CI job or
`RUN_INTEGRATION=1`).

---

## Tools (right tool per adapter)

| Adapter | Tier 2 target | Tooling |
|---------|---------------|---------|
| **SQLite** | Already real in tier 1 | `@effect/sql-sqlite-node`; add disk persistence tests only |
| **Prisma** | Real DB round-trip | Testcontainers **PostgreSQL** (or SQLite via Prisma) + migrated schema; drop or shrink structural mock once covered |
| **Redis** | Real Redis commands | **Testcontainers** `redis:alpine` + `ioredis` `send` adapter (see `repos/effect/packages/experimental/test/utils/redis.ts`) |
| **Hybrid** | Both legs | SQLite `:memory:` or Testcontainers PG **+** Testcontainers Redis in one suite |

Prefer **Testcontainers** over hand-rolled `docker compose` in CI so lifecycle
and ports are scoped per test file.

---

## What mocks remain valuable

- **Conformance doubles** — prove `selectRuntimeRecords`, readonly, and
  `transaction` semantics without I/O.
- **Prisma structural client** — fast regression on query translation **until**
  integration suite covers the same paths; then reduce mock surface area.
- **Unit tests** for codecs and key layout — no container needed.

---

## Implementation slices

| # | Deliverable |
|---|-------------|
| 1 | `test/utils/redis-container.ts` + gated redis conformance on real Redis |
| 2 | `pnpm test:integration` script + CI job (optional, Docker-enabled runners) |
| 3 | Prisma + Postgres (or SQLite) integration suite; trim mock where redundant |
| 4 | Hybrid integration suite once `layerRuntimeStorageHybrid` ships |
| 5 | Document in [STORAGE.md](../STORAGE.md) and [docs/AGENTS.md](../AGENTS.md) |

---

## Anti-patterns

- Replacing all tests with containers (slow, flaky CI).
- Building a full Prisma query emulator when Postgres testcontainers is cheaper.
- Skipping tier 1 conformance because tier 2 exists.
