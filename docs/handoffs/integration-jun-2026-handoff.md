# Integration branch handoff (June 2026)

## Branch

```text
cursor/integration-jun-2026
```

Optional second checkout (kept worktree):

```text
../effect-pm-alt  →  branch cursor/effect-pm-alt (tracks integration tip)
```

## What merged

| Source branch | Domain |
|---------------|--------|
| `cursor/queue-telemetry-migration-d791` | Queue facet telemetry, `emit*` helpers, conformance tests |
| `origin/cursor/remote-terminal-plan-c64a` | `ControlTransportRpc`, `CommandAuth`, `Terminal` / `TerminalRpc` |
| `origin/cursor/log-transport-rpc-c64a` | `LogTransportRpc` (union with Terminal — both kept) |
| `origin/cursor/dashboard-controls-logs-recipe-baec` | React controls/logs, `ops-ui` dashboard shell |

Effect toolchain: **`4.0.0-beta.75`**.

## Verification (integration tip)

```bash
pnpm install
pnpm test          # 358 passed (Prisma integration skipped when CLI missing)
pnpm run build
```

`pnpm run typecheck` may still report Effect language-service rules on examples, ops-ui shadcn files, and some tests; core package tests and build are green.

## Agent split (shared branch, topic branches optional)

Work from `cursor/integration-jun-2026` (or `cursor/effect-pm-alt` worktree). Merge topic PRs back into integration, not into each other.

| Topic branch (suggested) | Focus |
|--------------------------|--------|
| `cursor/telemetry-direct-emit` | `QueueResource.ts` → direct `QueueResourceStore.Entry.*` |
| `cursor/dashboard-polish` | `src/ops-ui/`, `examples/dashboard-demo/` |
| `cursor/rpc-adapter-migration` | HTTP → RPC for control/logs |
| `cursor/remote-console` | Remote terminal UX |

## Related handoff docs

See [Handoff index](#handoff-index) below.

## Push

```bash
git push -u origin cursor/integration-jun-2026
```

## Handoff index

### Active on this integration line

| Doc | Use when |
|-----|----------|
| [facet-telemetry-158c-handoff.md](./facet-telemetry-158c-handoff.md) | Telemetry factory, codec-backed facets, RunResource/queue store (update branch name to integration) |
| [remote-terminal-local-handoff.md](./remote-terminal-local-handoff.md) | Terminal RPC, `effect/unstable/rpc`, React `TerminalSessionPort` |
| [dashboard-ops-ui-local-agent.md](./dashboard-ops-ui-local-agent.md) | Ops UI Phase 1, `OperatorDashboard`, local agent scope |
| [wow-dashboard-slice-2-agent-prompts.md](./wow-dashboard-slice-2-agent-prompts.md) | WOW repo gateway + subtree sync for dashboard demo |

### Storage / Prisma

| Doc | Use when |
|-----|----------|
| [prisma-storage-followup-958b-review.md](./prisma-storage-followup-958b-review.md) | Prisma adapter review and merge notes |

### Recipes (design locks, not handoffs)

| Doc | Use when |
|-----|----------|
| [../recipes/queue-resource-telemetry-migration.md](../recipes/queue-resource-telemetry-migration.md) | Queue store telemetry migration (mostly done; optional direct worker emit) |
| [../recipes/queue-telemetry-index-batch.md](../recipes/queue-telemetry-index-batch.md) | Index metadata + direct `Entry.*` worker calls |
| [../recipes/dashboard-controls-logs.md](../recipes/dashboard-controls-logs.md) | Dashboard controls + live logs API |
| [../recipes/dashboard-layout-grid.md](../recipes/dashboard-layout-grid.md) | Persisted grid layout |
| [../recipes/command-authentication.md](../recipes/command-authentication.md) | Command auth enrollment |
| [../recipes/remote-terminal.md](../recipes/remote-terminal.md) | Remote terminal planning |

### Plans (roadmap context)

| Doc | Use when |
|-----|----------|
| [../plans/16-effect-rpc-transport-migration.md](../plans/16-effect-rpc-transport-migration.md) | RPC transport migration roadmap |
| [../plans/03-queue-remote-handoff.md](../plans/03-queue-remote-handoff.md) | Queue remote enqueue / release handoff (future) |
| [../plans/README.md](../plans/README.md) | Full plan ordering |

### Guides

| Doc | Use when |
|-----|----------|
| [../guides/dashboard-ops-ui.md](../guides/dashboard-ops-ui.md) | Embedding ops-ui + react primitives |
| [../STORAGE.md](../STORAGE.md) | Storage facets authoritative reference |
