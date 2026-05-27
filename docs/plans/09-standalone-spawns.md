# 09 — Standalone supervised instances **`Process.spawn`** & **`QueueResource.open`**

**Multi-instance ergonomics outside `ProcessGroup` tuples**:

- **`Process.spawn`**: forks supervisor/driver logic with an **opaque handle**
  (**suspend**, **wake**, graceful shutdown — **orthogonal** to schedule **`armed`** semantics).
- **`QueueResource.open`**: parallels **definition vs acquisition split** aligned
  with spawned processes.

Keeps **`ProcessGroup`** authoritative for fleet maps, **`ControlService`**
targets, and **`remoteLayer`** — spawned handles remain **caller-scope Effects**.

Deferred until modeled: **`Process.RemoteService`**, **`QueueResource.RemoteService`**, **`ProcessGroup.remoteLayers`** (depends on **`03-queue-remote-handoff.md`** honesty).
