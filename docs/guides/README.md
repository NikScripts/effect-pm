# Guides (current API)

How to wire the runtime on `main`: id-first **`Process`**, positional **`QueueResource`**, typed **`ProcessGroup.Service`**, **`ProcessManager.cli`** + endpoint config, and **`ControlService.layerHttp`**.

**Upgrading from commit `26b262b`?** See [MIGRATION-26b262b.md](./MIGRATION-26b262b.md).

Detail tables also live in [`docs/PROCESS-API.md`](../PROCESS-API.md), [`docs/RESOURCE-API.md`](../RESOURCE-API.md), and [`docs/CODEBASE-INVENTORY.md`](../CODEBASE-INVENTORY.md).

---

## Resources (define workers)

| Guide | Topic |
| --- | --- |
| [process.md](./process.md) | `Process.make` / `Process.Service` — register on a group; do not fork drivers ad hoc |
| [queue-resource.md](./queue-resource.md) | `QueueResource.Service(id, effect, options?)` and hooks |
| [resource-configure.md](./resource-configure.md) | `.configure` / `.wrapWorker` / `.wrapEffect` layer patches (no hot reload) |

---

## Orchestration & ops (run and control)

| Guide | Topic |
| --- | --- |
| [process-group.md](./process-group.md) | **`ProcessGroup.Service`**, contract, typed `start` / `queue()`, `LocalRuntime` |
| [process-manager.md](./process-manager.md) | **`ProcessManager.cli`**, endpoints, `group-start`, `connect`, `remoteLayer` |
| [control-plane.md](./control-plane.md) | **`ControlService`** HTTP (REST + `/control`) |
| [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md) | **Standard split:** service **tags** vs **Layer/runtime** modules (Vite / React / RN safe) |
| [dashboard-integration.md](./dashboard-integration.md) | **Embedded React widgets**, demo scope, **`peerDependencies`**, **API topology** (direct vs Next BFF), security notes |

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
