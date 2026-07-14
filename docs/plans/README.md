# Roadmap (future work)

Reviewed, **not-yet-shipped** features worth holding onto. Shipped behavior lives in the live
book (`docs/`), guides under `docs/guides/` / `docs/resources/`, and source TSDoc — not here.
Pre-1.0: breaking changes land as minor bumps.

## Toolkit

- **Guaranteed barrel-namespace tree-shaking** — make `import { QueueResource } from "@nikscripts/effect-pm"` + `QueueResource.Tag` tree-shake the engine in *every* bundler (subpath imports already do). Detailed plan: [18-unbundled-build-treeshaking.md](./18-unbundled-build-treeshaking.md).
- **Fleet health** — per-node readiness + `/health` / `NodeStatus` are **shipped**. Still open: a first-class **fleet-wide** health surface that aggregates peer readiness (without cascading “peer down” into local readiness). Builds on fleets/peers + readiness as they exist today.
- **Resource-RPC auth** — a first-class authentication/authorization story for served resources (deployments use an edge gateway / Cloudflare Zero Trust short-term). Spec TBD when scope is locked; stays a roadmap bullet until then.

## Orchestration

- **Weighted middle scheduling** — diversify the queue's middle priority into many weighted numeric/named groups pulled by a non-starving algorithm (DRR / strict), fixing strict-priority starvation. Design spec: [weighted-middle-scheduling.md](./weighted-middle-scheduling.md).
- **Non-serializable queue items** — local-only enqueue for function/`Effect` items; wire control + observability stay served. [queue-nonserializable-items.md](./queue-nonserializable-items.md).
- **Standalone spawns** — `Process.spawn` / `QueueResource.open`: multi-instance ergonomics where spawned handles are plain caller-scoped Effects (alongside `Group` + `Resource.serveInstances`).
- **Runtime identity & singleton runs** — in-process registry + a durable cross-runtime lease to prevent duplicate runs of the same logical process across hosts.
- **Lifecycle kernel (exploratory)** — typed transitions / eligibility for queues, items, processes, and schedule rows; projection-friendly events (not an external statechart engine).

## Persistence & storage

- **Postgres backends** for `HistoryStore` and `DurableQueueStore` (same interfaces; today: in-memory + SQLite).
- **Storage-adapter integration testing** — real-DB integration suites beyond the in-memory conformance tests.
- **Richer history vocabulary + listener/stream hooks** — for domains that need more than append-only facts, layered *beside* the store (never a process-store monolith).

## Durable queue refinements

(Both deferred in the durable-queue v1.)

- **Metrics downsampling** — roll windows 1s → 1m → 1h for long retention.
- **Multi-worker visibility-timeout / lease refresh** — v1 is single-host with a generous lease; add lease-refresh + `SKIP LOCKED` multi-worker semantics.

## Hygiene

- **Re-enable `anyUnknownInErrorContext`** — tighten the strict-unknown TypeScript/lint gate.
