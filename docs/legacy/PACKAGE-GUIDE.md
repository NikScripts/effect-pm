# effect-pm — package guide (humans & tooling)

This document is the **narrative companion** to the API tables in [PROCESS-API.md](./PROCESS-API.md) and the **future backlog** in [plans/README.md](./plans/README.md). Read it when you need *why* things exist and *how* pieces connect, not just signature-level *what*.

---

## What you are looking at

**effect-pm** (`@nikscripts/effect-pm`) is an [Effect](https://effect.website/)-first library for:

1. **Managed processes** — `Process`: a driver watches the schedule's run windows, spawns instances, and each instance repeats a user `Effect` on a **`Polling`** cadence until its window closes. Define one with `Process.Tag`, gate it with `Process.schedule` / `Process.window` / `Process.at` (or a reusable `Process.Schedule` resource).
2. **Queue resources** — `QueueResource`: priority queues with concurrency, throttling, retry, self-refill, and optional durability.
3. **Location transparency** — every resource is a `Resource` tag. `.layer` runs it local, `.serve` / `.serveRemote` host it over RPC (composed with `Resource.httpServer`), `Resource.client` reaches it remotely — the **same `yield* Tag` code either way**. `Resource.serveInstances` runs many instances behind one transport; `Group` organizes tags (nestable, multi-host).
4. **Persistence** — opt-in durability (`DurableQueueStore`) and observability history (`HistoryStore`), in-memory or SQLite; process/run analytics via `ProcessStore` / `RuntimeStorage`.

---

## Mental model (keep this picture)

```
┌───────────────────────────────────────────────────────────────────┐
│ Resource tag  (QueueResource / Process / …)                       │
│  • identity + contract (spec)                                     │
│  • `yield* Tag` — the SAME code local or remote                   │
└───────────────────────────────────────────────────────────────────┘
         │ provided by a layer
         ├─ .layer               → local engine in this runtime
         ├─ .serve / .serveRemote → host over RPC (serveInstances = many)
         └─ Resource.client      → remote handle (dashboard)
         ▼
┌───────────────────────────────────────────────────────────────────┐
│ engine  (queue worker pool  /  Process schedule driver)           │
│  • runs your `effect`; emits status / metrics / logs + *History   │
│  • optional persistence: DurableQueueStore / HistoryStore         │
└───────────────────────────────────────────────────────────────────┘
```

**Key distinction:** `Polling` answers “how often does an armed instance repeat?” the **schedule** (run windows) answers “should this instance keep running right now?” Stopping a process interrupts driver + child instances; disarming makes instances exit naturally.

---

## Where to read next (by goal)

| Goal | Start here |
|------|------------|
| Every resource / group / host / UI pattern | [guides/toolkit-by-example.md](./guides/toolkit-by-example.md) |
| History, durable queue, the dashboard data layer | [guides/history-and-persistence.md](./guides/history-and-persistence.md) |
| Queue / run / HTTP resource APIs | [RESOURCE-API.md](./RESOURCE-API.md) |
| Schedule composition + runtime updates | [examples/forms/schedule/](../examples/forms/schedule/) |
| Understand process runtime semantics | [PROCESS-API.md](./PROCESS-API.md) + `src/Process.ts` TSDoc |
| API tables (make, Polling, Schedule) | [PROCESS-API.md](./PROCESS-API.md) |
| Process storage facets (`ProcessStorage`, SQLite, Redis) | [STORAGE.md](./STORAGE.md) |
| UI / bundlers importing service tags | [guides/service-tags-and-runtime-split.md](./guides/service-tags-and-runtime-split.md) |
| AI / agent onboarding (repo map, conventions) | [AGENTS.md](./AGENTS.md) |

---

## Package subpaths

Root imports from `@nikscripts/effect-pm` remain backwards compatible. Prefer
dedicated subpaths for focused imports:

- `@nikscripts/effect-pm/Resource`
- `@nikscripts/effect-pm/Process` — `Process.Tag` / `Process.Schedule` + `make` / `layer` / `serve`
- `@nikscripts/effect-pm/QueueResource`
- `@nikscripts/effect-pm/Group`
- `@nikscripts/effect-pm/Logs` — runtime capture, relay, `persistLayer`, `byNode` / `byResource`
- `@nikscripts/effect-pm/HistoryStore`, `@nikscripts/effect-pm/DurableQueueStore`
- `@nikscripts/effect-pm/ProcessStore`
- `@nikscripts/effect-pm/storage/sqlite`
- `@nikscripts/effect-pm/storage/redis`

Structured logs use `LogStore` (`record`, `load`, `query`) with `ProcessStorage` or `layerProcessStore`;
node capture uses `@nikscripts/effect-pm/Logs` (`layer`, `persistLayer`, `stream`) — see
[`docs/LOGS.md`](../LOGS.md). (`NodeLogs` / `HostLogs` are deprecated shims.) Durable
normalized runtime records use `@nikscripts/effect-pm/storage/sqlite`
(`SQLiteRuntimeStorage`) with `ProcessStorage.layerRuntimeStorage`. Run
`SQLiteRuntimeStorage.make` under `Effect.scoped` (or `it.live`) so the
underlying `SqlClient` stays open for the whole usage window.

For durable adapter work, start with
[STORAGE.md](./STORAGE.md).

---

## Public entry points (from `src/index.ts`)

| Export area | Role |
|-------------|------|
| `Resource` | Toolkit foundation: `Tag` / `layer` / `serve` / `serveRemote` / `httpServer` / `client` / `Host` / `serveInstances` + `specOf` / `methodMeta`. |
| `QueueResource`, `Process` | Batteries-included resource kinds (queue / managed process). `Process.Schedule` is a standalone run-windows resource. |
| `Group` | Organize member tags (nestable; same or different hosts). |
| `Process`, `Polling` | The managed-process toolkit + engine (`Process.Tag` / `make`) and the poll-cadence gate (`Polling`). The run-window schedule primitive is internal. |
| `Logs`, `HistoryStore`, `DurableQueueStore` | Runtime-wide logs ([`docs/LOGS.md`](../LOGS.md)); metrics history; durable queue (in-memory or SQLite). |
| `ProcessStore` / `ProcessStorage` | Facet builder and combined storage layers for runtime records and resource facts. |
| `RunResource`, `HttpClientRunGate`, `HttpApiResource` | Concurrency/throttle gates and typed HttpApi client building blocks. |
| `disarmedIdleSleep` exports | Helpers for custom schedule logic. |

TSDoc on each module repeats details; this guide stays **concept-shaped**.

`RunResource` publishes run lifecycle facts and gate state transitions through the engine when
**`RunResource.store(tag)`** on an app **`Store.Service`** (or **`Store.layerDefaultMemory`**) is composed.
For live counters without durability, read toolkit handle **`Subscribable`** views (`run-resource-runtime-observer`
example).

---

## Dependencies and layers (practical rules)

1. **A resource `layer` acquires its engine in scope** — provide it once (`Effect.provide` at the app root) so the queue/process is acquired exactly once.
2. **Forking** a process driver needs **`R` plus any storage facets you compose**, where `R` is whatever remains after optional inlined `polling` / `schedule` layers. Use **`ProcessSupervisorRequirements<C>`** (exported type) if you build configs generically.
3. Prefer **`Layer.mergeAll(...)`** + **one** `Effect.provide` at the app root for many independent layers (clearer dependency graph; matches Effect lint guidance).
4. **Hosting (`httpServer`) is over RPC.** Auth/transport security is the deployment's responsibility (e.g. a private network or an edge gateway); a first-class auth story for `Resource` RPC is a future feature. Don't expose a host on the public internet without it.
5. **Browser / widget bundles** import only the **tag** (from its subpath, e.g. `@nikscripts/effect-pm/QueueResource`) — keep it **separate** from `Layer` / `serve` / storage wiring so client builds never resolve native adapters. See [guides/service-tags-and-runtime-split.md](./guides/service-tags-and-runtime-split.md).

---

## Examples directory

All runnable scripts live under `examples/`:

- **`examples/forms/`** — one API shape per file
- **`examples/scenarios/`** — descriptive compositions
- **`examples/shared/`** — test doubles and harness helpers

See [examples/README.md](../examples/README.md) for commands, learning paths, and file purposes. They are the **best teaching surface** after this guide.

---

## Architecture plans (`docs/plans/`)

These files are **future work only**. Shipped behavior lives in **`docs/*.md`**, **`docs/guides/`**, and TSDoc. [plans/README.md](./plans/README.md) lists priority order and topics.

---

## Version and toolchain

Package version and scripts live in `package.json`. Effect major line follows the repo’s pinned `effect` dependency; check `peerDependencies` before upgrading downstream apps.
