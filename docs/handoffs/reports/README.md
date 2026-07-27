# Agent reports index

**Live supervisor bus:** [`agent-status.md`](../agent-status.md) · [`supervisor-protocol.md`](../supervisor-protocol.md) · [`owner-decisions.md`](../owner-decisions.md).

**Active major Eng:** none unlocked for Agent 3. Last complete: [`identity-coordinator.md`](../identity-coordinator.md) M1–M6 + loud-failures core. Guide: [`docs/guides/identity-coordinator.md`](../../guides/identity-coordinator.md).

Historical review reports and session closeouts from the 2026-07 store cutover land under [`../archive/2026-07/`](../archive/2026-07/). This folder keeps only the **index** (so `AGENTS.md` / legacy links stay stable).

## Archived review reports (2026-07-07)

| Report | Scope |
|--------|-------|
| [Gate](../archive/2026-07/reports/2026-07-07-agent-report-run-resource.md) | Gate handle, RPC, store tap, docs sweep |
| [Daemon](../archive/2026-07/reports/2026-07-07-agent-report-process.md) | Tag wire slots, store contract, docs |
| [WorkPool + WorkPool.Service (untyped)](../archive/2026-07/reports/2026-07-07-agent-report-queue-resource.md) | Engine cutover, triplet |
| [Store](../archive/2026-07/reports/2026-07-07-agent-report-store.md) | Bridge typing, engine wiring |
| [Docs + release](../archive/2026-07/reports/2026-07-07-agent-report-docs-release.md) | Changesets, stale docs, examples |

## Related archive (same month)

| Doc | Role |
|-----|------|
| [Integration sync 2026-07-07](../archive/2026-07/agents/integration-sync-2026-07-07.md) | Merge context for that sync |
| [Branch cleanup manifest](../archive/2026-07/agents/branch-cleanup-manifest.md) | 2026-07-09 remote `cursor/*` audit |

## Store cutover handoffs (still at handoffs root — STORAGE cites them)

| Doc | Owner |
|-----|-------|
| [Store core](../store-cutover-00-store-core.md) | Shared decisions — **read first** |
| [Daemon](../store-cutover-daemon.md) | Daemon engine → `tag.store` |
| [WorkPool](../store-cutover-queue.md) | WorkPool engine |
| [Gate](../store-cutover-gate.md) | Gate cutover |
| [untyped WorkPool](../store-cutover-workpool-untyped.md) | untyped WorkPool cutover |

## Naming & RPC policy

- [`../result-schema-and-rpc-validation.md`](../result-schema-and-rpc-validation.md) — locked `payload` / `success` / `error`
