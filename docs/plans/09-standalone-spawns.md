# 09 — Standalone supervised instances **`Process.spawn`** & **`QueueResource.open`**

**Multi-instance ergonomics outside `ProcessGroup` tuples**.

Keeps **`ProcessGroup`** authoritative for fleet maps, **`ControlService`**
targets, and **`remoteLayer`** — spawned handles remain **caller-scope Effects**.

**Identity / singleton rules:** [12-runtime-identity-and-singleton-runs.md](./12-runtime-identity-and-singleton-runs.md)
(in-process registry + durable cross-runtime lease).

Deferred until modeled: **`Process.RemoteService`**, **`QueueResource.RemoteService`**, **`ProcessGroup.remoteLayers`** (depends on **`03-queue-remote-handoff.md`** honesty).

---

## `Process.spawn` API (agreed)

```ts
const process = Process.make("@repo/package/dirOrGroup/MyProcess", …);

// Named instance — stable logical id
Process.spawn("instanceName", process);
// id → @repo/package/dirOrGroup/MyProcess#instanceName

// Anonymous instance — generated suffix
Process.spawn(process);
// id → @repo/package/dirOrGroup/MyProcess#<generated>
```

### Handle behavior (planned)

- Forks supervisor/driver logic with an **opaque handle**.
- **Suspend**, **wake**, graceful shutdown — **orthogonal** to schedule **`armed`** semantics.
- **One live instance per spawn id** in scope (Layer 1); **storage lease** when
  shared storage is configured (Layer 2 — plan 12).

### `Process.make` id vs spawn suffix

- **Definition id** — path-style string on `Process.make`; used on **singleton**
  `Process.Service` / group entries — **no** `#instance` suffix.
- **`#instanceName` / `#<generated>`** — only when **multiple instances are allowed**
  (spawn path): logging, correlation, and controls for that instance — not for
  singleton service class ids.

---

## `QueueResource.open` (planned)

Parallels **definition vs acquisition** split aligned with spawned processes
(same mental model as `Process.make` vs `Process.spawn`).

Details TBD when queue remote/handoff (plan 03) is honest.

---

## Dependencies

- Plan **12** — `instanceId`, lease facet, duplicate prevention.
- Plan **03** — schemas, handoff, remote enqueue before `RemoteService`.
