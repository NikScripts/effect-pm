# Guides (current API)

These guides describe the **runtime-foundation** stack on `main`: id-first **`Process`**, positional **`QueueResource`**, typed **`ProcessGroup.Service`**, **`ProcessManager.cli`** + **endpoint config**, and **`ControlService.layerHttp`**.

They intentionally **do not** document removed or legacy paths (`Process.make({ name })`, `providePolling`, `{ queues, processes }` group shape) except where called out as “do not use.”

Older inventory-style dumps live in [`docs/CODEBASE-INVENTORY.md`](../CODEBASE-INVENTORY.md); treat these guides as the source of truth for how to wire apps today.

---

## Resources (define workers)

| Guide | Topic |
| --- | --- |
| [process.md](./process.md) | `Process.make` / `Process.Service` — register on a group; do not fork drivers ad hoc |
| [queue-resource.md](./queue-resource.md) | `QueueResource.Service(id, effect, options?)` and hooks |

---

## Orchestration & ops (run and control)

| Guide | Topic |
| --- | --- |
| [process-group.md](./process-group.md) | **`ProcessGroup.Service`**, contract, typed `start` / `queue()`, `LocalRuntime` |
| [process-manager.md](./process-manager.md) | **`ProcessManager.cli`**, endpoints, `group-start`, `connect`, `remoteLayer` |
| [control-plane.md](./control-plane.md) | **`ControlService`** HTTP (REST + `/control`), legacy `createCli` |

---

## Reading order

1. Define **queues** and **processes** (positional factories where it helps).
2. Declare **`ProcessGroup.Service(id, entries, endpoints?)`** and **`LocalRuntime`** for module launch.
3. Run **`ProcessManager.cli`** (`group-start`, then `start` / `ls` / `status`).
4. Optionally embed **`ControlService.layerHttp`** in the same Node process as the group.

---

## Planned

- Tagged **`QueueEvent`** + **`onEvent`** with **`Match.tag`** — [queue-resource.md](./queue-resource.md#planned-tagged-onevent-hooks)
- **`Process.spawn`** — group-owned process fibers without manual `group.start` ergonomics
