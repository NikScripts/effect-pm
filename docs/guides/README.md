# Guides

Long-form API guides (definition forms, config, types, related tools). Narrative rewrite: [`docs/rewrite/`](../rewrite/). Spec tables: [`docs/PROCESS-API.md`](../PROCESS-API.md), [`docs/RESOURCE-API.md`](../RESOURCE-API.md), [`docs/CODEBASE-INVENTORY.md`](../CODEBASE-INVENTORY.md).

## Resources

| Guide | Topic |
| --- | --- |
| [process.md](./process.md) | `Process.make`, `Process.Service`, config, group registration |
| [queue-resource.md](./queue-resource.md) | `QueueResource.Service`, `Tag`/`layer`, `make`, hooks (incl. planned `onEvent`) |

## Orchestration & control

| Guide | Topic |
| --- | --- |
| [process-group.md](./process-group.md) | `ProcessGroup.make`, `Service`, contract, typed controls, `remoteLayer` |
| [process-manager.md](./process-manager.md) | `ProcessManager.connect`, endpoints, multi-group CLI, remote limits |
| [control-plane.md](./control-plane.md) | `ControlService`, HTTP routes, `createCli` / `runCli`, `ControlProtocol` |

## Reading order

1. Define **processes** and **queues** (resource guides).  
2. Register them on a **ProcessGroup**.  
3. Expose **ControlService** locally and/or use **ProcessManager** remotely.
