# Client adapters — design notes (draft)

**Status:** design capture — not shipped. Owner + Agent G (TUI/dashboard) discussion 2026-07-24.  
**Related tip work:** TUI ↔ web Group dashboard parity (`cursor/tui-dashboard-parity-125f`); widget registry in `hyperlink-ts/ui`.

Capture so nothing from the conversation is lost. Decisions below are **direction**, not Eng’d APIs.

---

## Problem

1. **Dashboard custom cards** need a clean way to bind HyperService handle fields to UI without hand-rolling `runtime.atom` / `Stream.tick`.
2. **Consumers outside Effect** should still use a HyperService if they agree on the wire contract — Promise/async, TanStack Query, etc.
3. **One contract, many runtimes** — Effect reactive is the first-class dashboard path; other adapters are projections of the same Spec/handle surface.

---

## Hard rules (owner)

- **No polling** for live dashboard data. Live fields are push (`ref` / `subscribable` / `stream`). One-shot `effect` fields are queries/commands, not tick loops.
- Today’s `Stream.tick` usage in fleet bundles / `WorkerPoolCard` / daemon schedule is the **anti-pattern** relative to this rule — fix by making watched fields reactive on the contract, or query+invalidate, not timers.
- Widget **registry** (`forKind` / `forKey` / `withEntries` onto `base`) is the designed plug-in seam. Normal app use is `<Dashboard runtime group />`; registry assembly is for custom chrome, not the happy path.
- `GroupNode` name kept (docs clarify: group-tree node ≠ transport `Node`).
- Gate observe surface (`Pick<Gate.Handle, "status">`) was a small SSOT pilot; full handle-projected observe types parked until owner cares.

---

## Adapter stack (layers)

Ordered from “works anywhere” → “dashboard default.” Each layer sits on the **contract** (tag Spec / handle shape), not on a particular UI.

```
Contract (Hyperlink Spec / handle)
        │
        ├─► Promise / async client     (“works anywhere”, any runtime that can speak the wire)
        │         │
        │         └─► TanStack Query helpers   (real @tanstack/react-query, not an API clone)
        │                   │
        │                   └─► tRPC-shaped facade   (looks like tRPC; no tRPC dependency)
        │
        └─► Effect reactivity helpers  (effect/unstable/reactivity)  ← main dashboard path
                  │
                  └─► Dashboard hooks / bundles (useSubscribable, useQuery, useMutation, …)
```

### 1. Promise / async handle adapter — “game changer”

- Take a HyperService **client handle** (or tag + transport already connected) and expose every method as **Promise/async**.
- Goal: use the service **completely outside** an Effect runtime (scripts, Next handlers, non-Effect apps).
- Theoretically: generate clients for **any** runtime as long as the **contract is agreed** (same schemas / RPC).
- Open design: how much of serve/client stack is required vs pure wire codecs; error channel → rejected Promise vs Result type; streaming methods → async iterables?

### 2. TanStack helpers — use real TanStack

- **Not** “copy TanStack’s API onto atoms.”
- Depend on `@tanstack/react-query` (peer) and adapt Hyperlink Promise/Effect calls into `queryOptions` / `mutationOptions` / hooks that TanStack owns (cache, invalidate, staleTime, etc.).
- Builds on (1) or on Effect→Promise at the boundary.
- Invalidation keys should align with Spec method identity (tag key + method name), not ad-hoc strings where possible.

### 3. tRPC-like facade — shape only

- Ergonomics that **look like** tRPC (`api.WorkerPool.active.useQuery()`, `.useMutation()`) without shipping tRPC.
- Implemented **on top of** the TanStack helpers (and/or Effect reactive helpers), not a second stack.
- Driven by the Spec so new methods appear without hand-maintained procedure lists.

### 4. Effect reactive helpers — main (dashboard)

Uses official **`effect/unstable/reactivity`** (not standalone `@effect-atom`):

| Handle field | Helper direction | Behavior |
|--------------|------------------|----------|
| `ref` / `subscribable` / `stream` | `useSubscribable` / `useStream` (names TBD) | Subscribe; push updates → `AsyncResult` |
| `effect` (read) | `useQuery`-shaped over `runtime.atom(Effect)` | One-shot; `refresh` / `Reactivity.invalidate` — **no** `refetchInterval` as the live story |
| `effect` (command) | `useMutation`-shaped over `runtime.fn` | Same as today’s pause/resume atoms |

Still to discuss for (4):

- Exact hook names and module home (`hyperlink-ts/ui` vs `/web` vs a new `/client` or `/react` subpath).
- Subscribable selector vs Stream selector (`(g) => g.status` vs `(g) => g.status.changes`).
- How Spec-driven generation relates to hand-written bundles (`queueBundle`, …) — replace, wrap, or coexist.
- `Reactivity` keys + `Atom.swr` vs keeping bundles dumb.
- Whether Promise adapter and Effect reactive share one Spec walker.

---

## Dashboard context (already shipped / in flight)

- Shared `hyperlink-ts/ui`: data bundles, `groupRoute`, `memberKind` / `wireKindOf`, widget registry.
- Web + TUI: `<Dashboard runtime group path? widgets? />`; default `base` registry.
- Custom example: `examples/resource-web` — `withEntries(base, [forKey(WorkerPool.key, WorkerPoolCard)])`.
- TUI kind cells for gate/api/fleetHealth/telemetry/shardMap; unknown leaves show kind + node.

---

## Non-goals (for now)

- Polling helpers as the live-data API.
- Selling `widgets={withEntries…}` as the primary Dashboard DX.
- Full observe-surface `Pick` across every handle type (parked).
- Actually depending on tRPC.

---

## Next conversation

Walk the helpers top-down or dashboard-first (owner preference): lock names, subpaths, and what “Promise client from handle” requires on the wire — then Eng the Effect reactive dashboard hooks first.
