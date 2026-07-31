# Roadmap (future work)

Reviewed, **not-yet-shipped** features worth holding onto. Shipped behavior lives in the live
book (`docs/`), guides under `docs/guides/` / `docs/services/`, and source TSDoc — not here.
Pre-1.0: breaking changes land as minor bumps.

## Toolkit

- **Service / contract shapes** — taxonomy for materialize vs pull vs Tag-baked / adapters. Draft: [service-shapes.md](./service-shapes.md). Eng’d: `Tag`/`value`/`promise`/`default`/`defaults` + factory `{ defaults }` (`pure` retired); `cell` parked/rejected.
- **Wire groups & identity** — regular RpcGroup = tag key; shared Spec = `Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)` (kind-keyed wire, ordinary serve/client). W1–W3 Eng’d: [wire-groups-and-identity.md](./wire-groups-and-identity.md).
- **Guaranteed barrel-namespace tree-shaking** — make `import { WorkPool } from "hyperlink-ts"` + `WorkPool.Tag` tree-shake the engine in *every* bundler (subpath imports already do). Detailed plan: [18-unbundled-build-treeshaking.md](./18-unbundled-build-treeshaking.md).
- **Hyperlink-RPC auth** — a first-class authentication/authorization story for served resources (deployments use an edge gateway / Cloudflare Zero Trust short-term). Spec TBD when scope is locked; stays a roadmap bullet until then.

## Orchestration

- **Weighted middle scheduling** — diversify the queue's middle priority into many weighted numeric/named groups pulled by a non-starving algorithm (DRR / strict), fixing strict-priority starvation. Design spec: [weighted-middle-scheduling.md](./weighted-middle-scheduling.md).
- **Non-serializable queue items** — local-only enqueue for function/`Effect` items; wire control + observability stay served. [queue-nonserializable-items.md](./queue-nonserializable-items.md).
- **Standalone spawns** — `Daemon.spawn` / `WorkPool.open`: multi-instance ergonomics where spawned handles are plain caller-scoped Effects (alongside `Group`).
- **Runtime identity & singleton runs** — in-process registry + a durable cross-runtime lease to prevent duplicate runs of the same logical process across hosts.
- **Lifecycle kernel** — first-class `Lifecycle.Service` (badge + commands) any HyperService adopts; tools via `of`/`from` without kind switches. Substrate Eng’d on Agent 5 branch; dream gated on P-locks. Plan: [lifecycle-kernel.md](./lifecycle-kernel.md) · locks: [lifecycle-kernel-decisions.md](../handoffs/lifecycle-kernel-decisions.md).

## Persistence & storage

- **Storage correctness Soft stack** — **shipped** [#62](https://github.com/NikScripts/effect-pm/pull/62)/[#65](https://github.com/NikScripts/effect-pm/pull/65) (bake+override + untyped WorkPool Soft parity). Living plan: [storage-correctness.md](./storage-correctness.md). Remaining: fail-loud Soft / Phase C–D / Postgres (owner-gated).
- **Postgres backends** for `HistoryStore` and `DurableWorkPoolStore` (same interfaces; today: in-memory + SQLite).
- **Storage-adapter integration testing** — real-DB integration suites beyond the in-memory conformance tests.
- **Richer history vocabulary + listener/stream hooks** — for domains that need more than append-only facts, layered *beside* the store (never a process-store monolith).

## Durable queue refinements

(Both deferred in the durable-queue v1.)

- **Metrics downsampling** — roll windows 1s → 1m → 1h for long retention.
- **Multi-worker visibility-timeout / lease refresh** — v1 is single-host with a generous lease; add lease-refresh + `SKIP LOCKED` multi-worker semantics.

## Hygiene

- Parked erase debt (`toLayer` / wire `provideContext` / D1 factory retypes) — see archived
  [any-unknown-in-error-context.md](./archive/any-unknown-in-error-context.md).

## Archived (shipped)

Plans that finished Eng and left this index:

- [observe-recipes.md](./archive/observe-recipes.md)
- [fleet-rate-limiting.md](./archive/fleet-rate-limiting.md)
- [any-unknown-in-error-context.md](./archive/any-unknown-in-error-context.md)
