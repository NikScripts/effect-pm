> **Archived branch tip** from `archive/resource-toolkit-web-widgets` (was `rewrite/resource-toolkit`). Pre-rebrand dashboard widget handoff — living notes: `docs/handoffs/client-adapters-design.md` (Agent G).

# Handoff: Web dashboard widgets — per-type UI + missing contracts

Wire the shipped **`@nikscripts/effect-pm/web`** dashboard to every toolkit tag consumers put in a
`Group.Service` tree — starting with **`ApiMetrics`**, then closing gaps for **custom queues** and
**process schedules**. Branch: `rewrite/resource-toolkit`.

## Vision (from the user)

Live observability in the browser dashboard: queue/process cards today; **API usage panels** for
`ApiMetrics.Tag` leaves; no mis-rendered or empty cells when a new contract lands in the group tree.

---

## Current state — `@nikscripts/effect-pm/web`

The **generic introspection path is gone** (`.changeset/web-real-dashboard.md`):
`ResourceWidget`, `useResourceUI`, `binding`, `panels`, `primitives`, `chart` were removed. The
dashboard is **hand-crafted per type**.

### Entry point

```tsx
import { Dashboard } from "@nikscripts/effect-pm/web";
import { Atom } from "effect/unstable/reactivity";

<Dashboard runtime={Atom.runtime(appLayer)} group={Fleet} />
```

- `appLayer` = consumer's `Resource.client` / `connectHttp` layers over host-bound tags.
- `group` = root `Group.Service` tree (navigation = `Group.members` / drill-down).

### Data layer (`src/web/data.ts`, `src/web/runtime.tsx`)

| Export | Role |
|--------|------|
| `queueBundle(runtime, tag)` | Atoms + commands for one **QueueContract** tag |
| `processBundle(runtime, tag)` | Atoms + commands for one **ScheduledProcess** tag |
| `useQueueBundle` / `useProcessBundle` | Context memo wrappers |
| `kindOf(member)` | `"queue"` if spec has `enqueue` or `sizes`; else `"process"` |
| `leafTags` / `queueLeaves` / `processLeaves` | Walk `Group.Service` trees |

Bundles assume **fixed contract shapes** (not `specOf` introspection):

- **Queue:** `status` stream (`queueStatus`), `metrics` stream (`queueMetrics`), `logs`,
  `metricsHistory` / `logHistory`, `pause` / `resume` / `clear` / `shutdown`.
- **Process:** `status` stream (`processStatus`), `logs`, `logHistory`, `start` / `stop` /
  `runImmediately`.

LocalStorage seeding (`src/web/cache.ts`) backs logs, metric history, and pending trend for instant
paint + fewer concurrent streams (dedup under browser ~6-connection limit).

### Widgets (`src/web/widgets.tsx`)

**Queue:** `QueueCard`, `QueueStats`, `MetricChart`, `QueueControls`, `LogStream`  
**Process:** `ProcessCard`, `ProcessStats`, `ProcessControls`  
**Navigation:** `GroupCard`, `Cell` (group \| queue \| process)  
**Shared:** `Stat`, `StatusBadge`, `ActionButton`, `ConfirmDialog`, `LockToggle`

### Dashboard views (`src/web/Dashboard.tsx`)

- Grid: `Cell` per group member.
- Detail: `QueueDetail` (stats + chart + controls + logs) or `ProcessDetail`.
- Route: `/…/Resource/logs` fullscreen log viewer.
- **Unknown or misclassified leaves:** empty fragment or wrong widget (see gaps below).

### Example fleet (`examples/apps/dashboard/fleet.ts`)

Only **QueueResource.Tag** (QueueContract) + **ScheduledProcess.Tag** — the happy path the dashboard
was built against.

---

## Backend already shipped (emit side — not wired to web)

Commit `70146c542` on `rewrite/resource-toolkit`:

### `HttpApiResource.Service`

- Class factory + `.layer` (functional `make` unchanged).
- Endpoint usage metrics + internal registry hooks (`instrumentEndpoints`).
- Effect `Metric.*` labels: `client`, `group`, `endpoint`, `outcome` / `error`.
- Subpath: `@nikscripts/effect-pm/HttpApiResource`.

### `ApiMetrics` (`src/ApiMetrics.ts`)

- **`Resource.tagFor("apiMetrics", …)`** — many instances, **one RPC group** (not per-instance
  `Resource.Tag`).
- Tag API:

  ```ts
  export const NwslClientId = "@app/Nwsl" as const;

  class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>(NwslClientId)() {}
  // tag.key === "@app/Nwsl/metrics"
  // tag[clientIdSym] === "@app/Nwsl"
  ```

- Spec (package-defined, not user-defined):
  - `metrics: Resource.stream(apiUsageMetrics)` — windowed; includes **`throughputPerSec`**
  - `usageNow: Resource.query(apiUsageSnapshot)` — cumulative totals + `topEndpoints`
- `layer` / `layerFor(metricsTag, HttpApiResource.Service)` — link by **`clientId` string**
- `serveInstances` / `clientInstances` / `instance` — factory injected internally
- Subpath: `@nikscripts/effect-pm/ApiMetrics` (browser-safe; no `HttpApi` / engine imports)
- Schemas: `@nikscripts/effect-pm/ApiUsageSchema`

### Internal registry (`src/internal/apiUsageRegistry.ts`)

- Keyed by `clientId` string (same as `HttpApiResource.Service` key).
- `HttpApiResource` layer registers sink; `ApiMetrics.layer` reads it.
- Emits window on each endpoint event (+ periodic schedule fiber for idle windows).

**Not built:** cross-host aggregation → still `docs/handoffs/telemetry-resource.md` (deferred).

---

## Gap matrix — tags vs dashboard

| Tag / contract | Dashboard today | Problem |
|----------------|-------------------|---------|
| **QueueContract** / `QueueResource.Tag` | **Full** | Reference implementation |
| **ScheduledProcess** / `processTag` | **Full** | Reference implementation |
| **ApiMetrics.Tag** | **None** | No bundle/widgets; not in `kindOf`; must not import `HttpApiResource.Service` in browser tags file |
| **CustomQueueContract** / `CustomQueueResource.Tag` | **Broken if used** | `kindOf` → queue (has `sizes`), but status uses **named lanes**, not `high/normal/low` — cards/stats/chart wrong |
| **ProcessScheduleContract** | **Broken if used** | `kindOf` → process; spec has CRUD/`reconcile`/`changes`, not `start`/`stop`/`runImmediately` |
| **HttpApiResource.Service** | **N/A** | Not a Resource tag; not a Group leaf |
| **HostLogs** | **N/A** | Runtime layer, not toolkit tag in Group |
| **Generic `Resource.Tag`** | **None** | Old generic widget removed intentionally |

---

## Design decisions (settled in thread)

1. **No generic `ResourceWidget` revival** — extend the hand-crafted pattern (`queueBundle` shape).
2. **`ApiMetrics` is not `HttpApiResource.Tag`** — observability is a separate toolkit family via
   `tagFor`, linked by **`clientId` string** (`clientIdSym = Symbol.for(…)`).
3. **Browser split:** `tags.ts` imports only `ApiMetrics` + `clientId` constant; runtime imports
   `HttpApiResource.Service` + `ApiMetrics.layerFor`.
4. **Third `kindOf` value** (e.g. `"apiMetrics"`) — do not fall through to `"process"`.
5. **Queue `MetricChart` patterns** are reusable for API throughput (same `throughputPerSec` field on
   stream elements).
6. **`Telemetry` resource** remains separate for host-wide / cross-host aggregation; `ApiMetrics` is
   per-client usage for the dashboard detail page.

---

## Recommended work — priority order

### 1. `ApiMetrics` widgets (highest — backend ready)

**`src/web/data.ts`**

- `ApiUsageMetrics` / `ApiUsageSnapshot` types from `ApiUsageSchema`.
- `ApiMetricsTag` type alias.
- `apiMetricsBundle(runtime, tag)`:
  - `metrics` atom (latest window)
  - `history` atom (accumulated chart points from `throughputPerSec`, optional latency from
    `byEndpoint[].avgDurationMs`)
  - `usageNow` read atom (poll or refresh on navigation; contract is query not stream)
  - Optional: `topEndpoints` derived from latest `usageNow` or metrics window
- `useApiMetricsBundle` in `runtime.tsx`.

**`kindOf`**

```ts
"metrics" in spec && "usageNow" in spec && !("enqueue" in spec)
  ? "apiMetrics"
  : …
```

(Order matters — check ApiMetrics before generic process fallback.)

**`src/web/widgets.tsx`**

- `ApiMetricsCard` — grid: requests window, error count, throughput, linked client id (from tag metadata if exposed, else display name only).
- `ApiMetricsStats` — requests / errors / inFlight / thr/s.
- `ApiMetricsChart` — reuse queue chart patterns (`throughputPerSec`; optional second series for errors).
- `ApiMetricsEndpoints` — table of `topEndpoints` or `byEndpoint` (group + endpoint + requests + errors).

**`src/web/Dashboard.tsx`**

- `Cell`: branch for `kindOf === "apiMetrics"`.
- `ApiMetricsDetail` — stats + chart + endpoints table (no controls v1 — read-only).
- `isApiMetricsTag` narrow for routes / logs (ApiMetrics has **no `logs`** — skip log route or hide log button).

**Example**

- Add `ApiMetrics.Tag` sibling under a group in `examples/apps/dashboard/fleet.ts` (or separate demo)
  with matching `HttpApiResource.Service` on server only.

**Tests**

- Unit test `kindOf` classification for ApiMetrics vs queue vs process tags (no DOM required).
- Optional: lightweight render test if the repo has a pattern.

### 2. Custom queue widgets (medium)

Either:

- **A.** Extend `QueueCard` / `QueueStats` to accept a shared “queue-like” status interface (lanes map →
  dynamic priority bars), or
- **B.** Add `kindOf === "customQueue"` + `customQueueBundle` + parallel widgets.

Custom queue already exposes `status`, `metrics`, `logs`, `pause`, etc. (`CustomQueueContract`) —
closest to queue; prefer **A** if shapes can be normalized in the bundle layer.

### 3. Process schedule widgets (lower)

New kind + CRUD UI (`entries`, `reconcile`, `changes` stream) — distinct from process supervision.
Likely a table + edit affordances, not start/stop controls. Defer until ApiMetrics + custom queue are
done unless product needs it sooner.

### 4. Telemetry panels (future — separate handoff)

Host-wide aggregation UI consumes `Telemetry` resource, not per-leaf widgets. See
`docs/handoffs/telemetry-resource.md`. Do not conflate with `ApiMetrics` detail pages.

---

## Files to touch (ApiMetrics slice)

| File | Change |
|------|--------|
| `src/web/data.ts` | `apiMetricsBundle`, `kindOf`, types |
| `src/web/runtime.tsx` | `useApiMetricsBundle` |
| `src/web/widgets.tsx` | `ApiMetricsCard`, `ApiMetricsStats`, `ApiMetricsChart`, … |
| `src/web/Dashboard.tsx` | `Cell`, `ApiMetricsDetail`, route guards |
| `src/web/index.ts` | Export new hooks/types if public |
| `examples/apps/dashboard/*` | Demo tag + server wiring |
| `docs/guides/toolkit-by-example.md` or web setup guide | Short ApiMetrics dashboard section |
| `.changeset/*.md` | Minor if only `@nikscripts/effect-pm/web` behavior |

**Do not re-add** `src/web/binding.ts` / `ResourceWidget.tsx` unless product explicitly reverses the
real-dashboard decision.

---

## Browser-safe tag file pattern

```ts
// tags.ts — dashboard bundle imports this only
import { ApiMetrics } from "@nikscripts/effect-pm/ApiMetrics";

export const NwslClientId = "@app/Nwsl" as const;
export class NwslMetrics extends ApiMetrics.Tag<NwslMetrics>(NwslClientId)() {}

// runtime.ts — server / Node only
import { HttpApiResource } from "@nikscripts/effect-pm/HttpApiResource";
import { ApiMetrics } from "@nikscripts/effect-pm/ApiMetrics";

Layer.mergeAll(
  NwslClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  ApiMetrics.layerFor(NwslMetrics, NwslClient),
);
```

Group tree includes **`NwslMetrics`** as a leaf (not `NwslClient`).

---

## Coordination

- **Emit side** — done (`HttpApiResource` + `ApiMetrics` + registry). See `.changeset/api-metrics.md`.
- **This handoff** — read side in `src/web/`.
- **`telemetry-resource.md`** — host-wide panels; later.
- **`api-resource-metrics.md`** — **stale** (planned `ApiResource` rename + Telemetry-only read path).
  Actual ship kept `HttpApiResource` name and added **`ApiMetrics`** as the dashboard contract. Update
  or supersede that doc when touching docs.

---

## Gate

- `pnpm run typecheck` (both tsconfigs)
- `pnpm lint`
- `pnpm build`
- `pnpm test`
- Manual: `examples/web-dashboard` with an `ApiMetrics` leaf — grid card + detail + chart update live
  when the gated client runs on the server.
- Changeset if public `@nikscripts/effect-pm/web` exports change.

---

## Out of scope for this handoff

- Renaming `HttpApiResource` → `ApiResource`
- `ApiResource` / `ApiMetrics` runtime controls (`setConcurrency`, etc.)
- Cross-host metric aggregation (`Telemetry`)
- TUI parity (`examples/resource-tui`) — optional follow-up after web lands
