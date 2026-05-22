# ProcessManager playground

Two typed **ProcessGroup** runtimes you launch from the CLI, then drive with **process** and **queue** controls. Good for trying `start <group>`, `ls`, `status`, `pause` / `resume`, and contract-aware targets.

## Prerequisites

From the package root:

```bash
pnpm install
```

## Terminal 1 — operator CLI

```bash
pnpm run demo:pm -- groups
pnpm run demo:pm -- ls
```

## Terminal 2 — start runtimes (out-of-process)

```bash
pnpm run demo:pm -- start workshop-group
pnpm run demo:pm -- start analytics-group
```

Child processes write logs under `.effect-pm/logs/` and run state under `.effect-pm/run/groups/`.

## Play with controls

```bash
# Workshop: polling feeder + job queue (jobs ending in "7" fail once, then retry)
pnpm run demo:pm -- start workshop/feeder
pnpm run demo:pm -- status workshop/feeder
pnpm run demo:pm -- status workshop/job-queue
pnpm run demo:pm -- pause workshop/job-queue
pnpm run demo:pm -- resume workshop/job-queue
pnpm run demo:pm -- clear workshop/job-queue

# Analytics: sampler + counter queue
pnpm run demo:pm -- now analytics/sampler
pnpm run demo:pm -- stop analytics/sampler

# Inspect everything
pnpm run demo:pm -- ls --json
pnpm run demo:pm -- verify

# Tear down
pnpm run demo:pm -- group-stop workshop-group
pnpm run demo:pm -- group-stop analytics-group
```

## Ports

| Group | Default port | Env override |
| --- | --- | --- |
| Workshop | 32201 | `DEMO_WORKSHOP_PORT` |
| Analytics | 32202 | `DEMO_ANALYTICS_PORT` |

## Layout

| File | Role |
| --- | --- |
| `workshop-definition.ts` | `WorkshopGroup`, processes, queues, inline `Endpoint.local` / `production` |
| `analytics-definition.ts` | Same layout for analytics |
| `cli.ts` | `ProcessManager.cli([WorkshopGroup, AnalyticsGroup])` |
| `ports.ts` | Default localhost control ports |

## Related docs

- [process-manager.md](../../../docs/guides/process-manager.md)
- [control-plane.md](../../../docs/guides/control-plane.md)
