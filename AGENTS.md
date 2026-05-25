# Agent instructions

Start with [`docs/AGENTS.md`](./docs/AGENTS.md) for this package's architecture, invariants, and verification commands.

**Persistence:** [`docs/STORAGE.md`](./docs/STORAGE.md) — one stack only: `RuntimeStorage` + per-domain `ProcessStore*` facets composed via the `ProcessStore` namespace. **Logs:** capture/relay live in [`@nikscripts/effect-pm/Logs`](./docs/ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md) only; durable history uses `ProcessStoreLog` (`store/log.ts`). See [`docs/ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md`](./docs/ARCHITECTURE-AUDIT-AND-LOGS-SEPARATION.md).

## Vendored repositories

External repositories live under `repos/` as read-only reference material for agents.

- Use vendored repositories to inspect idiomatic upstream source, tests, module structure, and API design.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application and package code must continue importing from normal package dependencies.
- When writing Effect code, inspect `repos/effect/` for examples and API patterns before guessing from memory.
