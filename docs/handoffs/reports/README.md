# Agent reports — sync 2026-07-07

Separate handoffs for **parallel agents**. Each report is scoped to one module (or one cross-cutting concern). Work on **`cursor/integration-result-schema-a3ad`** or merge it into your feature branch before starting.

| Report | Agent scope | Priority |
|--------|-------------|----------|
| [RunResource](./2026-07-07-agent-report-run-resource.md) | Gate handle, RPC, store tap, docs sweep | **Low** — mostly done; finish + verify |
| [Process](./2026-07-07-agent-report-process.md) | Tag wire slots, `error` wiring, engine store tap | **High** |
| [QueueResource + CustomQueueResource](./2026-07-07-agent-report-queue-resource.md) | `itemSchema` → `payload`, success/error triplet | **High** |
| [Store](./2026-07-07-agent-report-store.md) | Bridge typing, default store, engine wiring gaps | **Medium** |
| [Docs + release](./2026-07-07-agent-report-docs-release.md) | Changesets, stale docs, examples README | **Medium** (after module PRs land) |

**Coordination:** [`../2026-07-07-rpc-schema-names-payload-success-error.md`](../2026-07-07-rpc-schema-names-payload-success-error.md) · **RPC fingerprint (deferred):** [`../result-schema-and-rpc-validation.md`](../result-schema-and-rpc-validation.md)

**Verify (all agents):**

```bash
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```
