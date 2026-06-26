# Roadmap (future work)

Reviewed, **not-yet-shipped** features worth holding onto. Implemented/legacy plans were removed —
shipped behavior lives in the regular docs (`README.md`, `PROCESS-API.md`, `STORAGE.md`,
`guides/*`) and source TSDoc, not here. Pre-1.0: breaking changes land as minor bumps.

## Toolkit

- **Guaranteed barrel-namespace tree-shaking** — make `import { QueueResource } from "@nikscripts/effect-pm"` + `QueueResource.Tag` tree-shake the engine in *every* bundler (subpath imports already do). Detailed plan: [18-unbundled-build-treeshaking.md](./18-unbundled-build-treeshaking.md).
- **Resource Host health/status** — a health/status surface on `Resource.Host` / served instances (Host now exists, so this is buildable).
- **Resource-RPC auth** — a first-class authentication/authorization story for served resources (replaces the dropped `CommandAuth`; deployments use an edge gateway / Cloudflare Zero Trust short-term).
- **`ProcessManagerLog*` → neutral rename** — the kept log infra (`ProcessManagerLogEntry` / `Relay` / `AnnotationKeys`) carries a vestigial name; rename to `Log*` / `HostLog*` (no behavior change).

## Orchestration

- **Standalone spawns** — `Process.spawn` / `QueueResource.open`: multi-instance ergonomics where spawned handles are plain caller-scoped Effects (alongside `Group` + `Resource.serveInstances`).
- **Runtime identity & singleton runs** — in-process registry + a durable cross-runtime lease to prevent duplicate runs of the same logical process across hosts.
- **Lifecycle kernel (exploratory)** — typed transitions / eligibility for queues, items, processes, and schedule rows; projection-friendly events (not an external statechart engine).

## Persistence & storage

- **Postgres backends** for `HistoryStore` and `DurableQueueStore` (same interfaces; today: in-memory + SQLite).
- **Hybrid `RuntimeStorage`** — one adapter routing internally across SQL + Redis. Design spec: [15-runtime-storage-hybrid.md](./15-runtime-storage-hybrid.md).
- **Storage-adapter integration testing** — real-DB integration suites beyond the in-memory conformance tests.
- **Richer history vocabulary + listener/stream hooks** — for domains that need more than append-only facts, layered *beside* the store facets (never a `ProcessStore` monolith).

## Durable queue refinements

(Both deferred in the durable-queue v1.)

- **Metrics downsampling** — roll windows 1s → 1m → 1h for long retention.
- **Multi-worker visibility-timeout / lease refresh** — v1 is single-host with a generous lease; add lease-refresh + `SKIP LOCKED` multi-worker semantics.

## Hygiene

- **Re-enable `anyUnknownInErrorContext`** — tighten the strict-unknown TypeScript/lint gate.
