# Guides

How to build with the toolkit: location-transparent **`Resource`** tags (`QueueResource`,
`Process` / `Process.Schedule`), nestable **`Group`**, persistence, and the
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
| [beta-15-to-17.md](./beta-15-to-17.md) | **Upgrade guide** — custom resources (15) → multi-host (16) → durable logs + fleet ergonomics (17), with migration notes |

## Resources (define workers)

| Guide | Topic |
| --- | --- |
| [process.md](./process.md) | `Process` — the `Process.Tag` toolkit + the `Process.make` engine |
| [queue-resource.md](./queue-resource.md) | `QueueResource` — priority, concurrency, `rateLimit`, `refill`, `persist` |
| [resource-configure.md](./resource-configure.md) | `.configure` layer patches (per-env overrides) |
| [per-resource-dependencies.md](./per-resource-dependencies.md) | Serving resources that need **different** implementations of the same dependency, isolated — `Resource.serve` / `httpServer` |

## Ops & UI

| Guide | Topic |
| --- | --- |
| [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md) | Service **tags** vs **Layer/runtime** modules (Vite / React / RN safe) |

---

## Reading order

1. Define **queues** (`QueueResource`) and **managed processes** (`Process`).
2. Provide them **local** (`.layer`) or **served** (`.serve` on the host, composed with
   `Resource.httpServer`; `Resource.client` on the dashboard) — same `yield* Tag` either way.
3. Opt into **persistence** (`persist`, `HistoryStore` / `SQLiteHistoryStore`) where you need
   durability or history.
4. Organize with **`Group`** (nestable; members may live on different hosts).
