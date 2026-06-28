# Guides

How to build with the toolkit: location-transparent **`Resource`** tags (`QueueResource`,
`ScheduledProcess`, `ProcessScheduleResource`), nestable **`Group`**, persistence, and the
dashboard data layer.

Detail tables also live in [`docs/PROCESS-API.md`](../PROCESS-API.md),
[`docs/RESOURCE-API.md`](../RESOURCE-API.md), and [`docs/STORAGE.md`](../STORAGE.md).

---

## Start here

| Guide | Topic |
| --- | --- |
| [setup.md](./setup.md) | **Consuming the package** — install + peer deps, the subpaths, wiring a server + CLI/TUI/web against your tags |
| [toolkit-by-example.md](./toolkit-by-example.md) | Every resource / group / host / UI pattern, by example |
| [history-and-persistence.md](./history-and-persistence.md) | History (`*History`), the durable queue (`persist`), the dashboard query-then-tail |

## Resources (define workers)

| Guide | Topic |
| --- | --- |
| [process.md](./process.md) | `ScheduledProcess` / the `Process` engine |
| [queue-resource.md](./queue-resource.md) | `QueueResource` — priority, concurrency, `rateLimit`, `refill`, `persist` |
| [resource-configure.md](./resource-configure.md) | `.configure` layer patches (per-env overrides) |

## Ops & UI

| Guide | Topic |
| --- | --- |
| [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md) | Service **tags** vs **Layer/runtime** modules (Vite / React / RN safe) |

---

## Reading order

1. Define **queues** (`QueueResource`) and **scheduled processes** (`ScheduledProcess`).
2. Provide them **local** (`.layer`) or **remote** (`.serveHttp` on the host; `Resource.client` on
   the dashboard) — same `yield* Tag` either way.
3. Opt into **persistence** (`persist`, `HistoryStore` / `SQLiteHistoryStore`) where you need
   durability or history.
4. Organize with **`Group`** (nestable; members may live on different hosts).
