# Handoff — ApiResource dashboard widget + PagedCard

**Status:** design locked, not yet implemented. Build to this spec.
**Branch:** `rewrite/resource-toolkit`.
**Date:** 2026-06-28.

## Goal

Add a hand-crafted, per-type dashboard widget for the **API resource** — i.e. the
`ApiMetrics` observability tap that sits over an `HttpApiResource` client. It joins the
existing queue and process widgets in `src/web/widgets.tsx`, driven the same way (a **tag** →
an atom **bundle** built over the reactive runtime). This is a hand-crafted widget per resource
type; do **not** build a generic introspection UI.

The API resource is **read-only**: no pause/clear/shutdown controls, and **no log stream**.

## Data surface (what the widget consumes)

The tag is an `ApiMetrics` instance tag (`src/ApiMetrics.ts`). Its wire spec
(`ApiMetricsSpec`) has exactly two members, whose schemas live in `src/ApiUsageSchema.ts`:

- **`metrics`** — a `Stream` of windowed `ApiUsageMetrics`, one element per window:
  - `windowStart`, `windowEnd` (`DateTimeUtc`), `windowMillis`
  - `requests`, `errors`, `inFlight`, `throughputPerSec`
  - `byEndpoint: ReadonlyArray<{ group, endpoint, requests, errors, avgDurationMs? }>`
- **`usageNow`** — a `query` (Effect) returning an `ApiUsageSnapshot`:
  - `clientId`, `inFlight`, `requestsTotal`, `errorsTotal`
  - `topEndpoints: ReadonlyArray<{ group, endpoint, requests, errors }>`

The materialized service a tag yields (`Resource.ServiceOf<ApiMetricsSpec>`):

```ts
interface ApiService {
  readonly metrics: Stream.Stream<ApiUsageMetrics>;
  readonly usageNow: Effect.Effect<ApiUsageSnapshot>;
}
```

The **distinguishing data** vs. queues/processes is the **per-endpoint breakdown**
(`byEndpoint` / `topEndpoints`). Build the widget around it the way `QueueCard` is built around
the high/normal/low priority bars.

## Locked design decisions

1. **Introduce a reusable `PagedCard`** — iOS-home-screen-style horizontal paging with **dot
   page indicators at the bottom**. Presentational, not API-specific.
2. **Scope this pass: `PagedCard` + `ApiCard` only.** Do **not** retrofit `QueueCard` /
   `ProcessCard` to paging — they stay single-face. They can adopt `PagedCard` later.
3. **`ApiCard` pages**, in order:
   1. **Sparkline + health** (the **default** first page): throughput sparkline + `req/s` +
      in-flight + a health badge.
   2. **Top-endpoint bars**: 2–3 busiest endpoints as labelled request bars (reuse the
      `Bar` / `PrioRow` pattern from `widgets.tsx`).
   3. *(optional, add if cheap)* a totals / error-rate stat strip.
4. **Health badge is driven by error rate** (green / amber / red), **not** a phase. There is no
   running/paused concept for an API client.

### Card mockups (the two faces)

```
page 1 (default)                      page 2
┌──────────────────────────┐         ┌──────────────────────────┐
│ NwslClient    ● healthy   │         │ NwslClient    ● healthy   │
│ 12.4 req/s    3 in-flight │         │ GET /games ███████████ 840│
│   ╱╲╱╲  ╱╲___╱╲           │  swipe  │ GET /teams ████ 290       │
│                           │   →     │ POST /sync █ 70           │
│         ● ○ ○             │         │         ○ ● ○             │
└──────────────────────────┘         └──────────────────────────┘
```

## Widget set to build (`src/web/widgets.tsx`)

Mirror the queue/process trio, all read-only:

- **`PagedCard`** — reusable wrapper. `<PagedCard pages={ReadonlyArray<ReactNode>} onOpen?
  accent? />`. See mechanics below.
- **`ApiCard`** — grid card, parallel to `QueueCard`. Uses `PagedCard` with the page faces
  above. Title = `displayName(clientId)`. Tap opens the detail view.
- **`ApiStats`** — parallel to `QueueStats`. Stat cards: `requests` (total), `errors` (total),
  `error rate %`, `in-flight`, `req/s`.
- **`ApiMetricChart`** — parallel to `MetricChart`. Same `AreaChart` shell + dropdown switching
  **throughput /s**, **errors**, **in-flight**, fed from the accumulated `metrics` history.
- **`ApiEndpointTable`** — the distinctive one. `group · endpoint` rows with
  requests / errors / avg-ms, sorted by requests, error rows tinted. This is what makes it read
  as an *API* widget and not a recolored queue.
- A small **error-rate → health** helper (`errors / requests` → label + colour), shared by the
  card badge and `ApiStats`.

### `PagedCard` mechanics (no new dependencies)

- Horizontal CSS `scroll-snap` track (`scroll-snap-type: x mandatory`), one
  `w-full snap-center` panel per page.
- Touch swipe is native; trackpad/drag too.
- Dots below the track; active index derived from `scrollLeft / clientWidth` in an `onScroll`
  handler. Tapping a dot `scrollTo({ left: index * width, behavior: "smooth" })`.
- **Tap-to-drill still works:** a tap fires `onClick` (open detail); a swipe scrolls and the
  browser suppresses the click. The one structural change: the card root goes from `<button>`
  to a `<div role="button" tabIndex={0}>` so a horizontal scroller can nest inside it cleanly
  (no nested interactive controls).

## Data layer work (`src/web/data.ts`)

- Add `ApiService` interface (above) and `ApiTag<R = never>` — structural, like `QueueTag`:
  `Effect.Effect<ApiService, never, R> & { readonly key: string }`.
- Add `ApiBundle` interface: `status` (from `usageNow`), `metrics` + accumulated `history`
  (from the `metrics` stream). **No command atoms.**
- Add `apiBundle(runtime, tag)` — memoized per runtime+tag like `queueBundle`. Reuse
  `cachedAccumulator` for the `metrics` history; cache keys keyed off `tag.key` (e.g.
  `${tag.key}/api-history`).
- Add an **`"api"` branch to `kindOf`** and an `apiLeaves` walker (parallel to `queueLeaves` /
  `processLeaves`).

### ⚠️ `kindOf` discriminator — read this

`kindOf` currently returns `"queue"` when the spec has `"enqueue"` or `"sizes"`, else
`"process"`. An API tag has neither, so it would be **misclassified as a process**.

Do **not** key the API branch on `"metrics"` — the **queue spec also has a `metrics` member**
(and `status` / `statusNow`). The member unique to `ApiMetricsSpec` is **`usageNow`**. Order
the checks:

```
if "enqueue" in spec || "sizes" in spec  → "queue"
else if "usageNow" in spec               → "api"
else                                     → "process"
```

## Dashboard wiring (`src/web/Dashboard.tsx`, `src/web/runtime.tsx`)

- `src/web/runtime.tsx`: add `useApiBundle(tag) => apiBundle(useRuntime(), tag)`.
- `src/web/Dashboard.tsx`:
  - Add `isApiTag` narrowing (`kindOf(m) === "api"`).
  - Add `ApiDetail` — header + `ApiStats` + `ApiMetricChart` + `ApiEndpointTable`. **No
    controls, no `LogBox`.**
  - Add the `"api"` cases to the `Cell` dispatch and the detail-view switch.
  - **No logs route for API** — skip the `route.view === "logs"` path for API tags.

## Constraints (project rules — non-negotiable)

- **No `as` type casts** anywhere; fix shapes structurally (define `ApiTag` structurally like
  `QueueTag`).
- **Naming:** PascalCase only for types/components/namespaces; values (incl. schema + symbol
  consts) are camelCase.
- **Formatting:** one field per line in multi-field objects/params (small-screen editing); never
  collapse onto one line.
- Verify Effect lint with `effect-language-service diagnostics --file <path>` (editor-only rules
  tsc/tsgo miss).

## Reference files

- `src/ApiMetrics.ts`, `src/ApiUsageSchema.ts` — the tag + wire schemas.
- `src/web/widgets.tsx` — existing queue/process widgets to mirror (`QueueCard`, `QueueStats`,
  `MetricChart`, `Bar`, `PrioRow`, `Stat`).
- `src/web/data.ts` — `queueBundle` / `processBundle` / `cachedAccumulator` / `kindOf` to
  mirror.
- `src/web/Dashboard.tsx` — `Cell` dispatch + detail switch to extend.
- `src/Resource.ts` — `ServiceOf`, `stream`, `query`, `specOf` (how a tag materializes its
  service).
- Prior handoff `docs/handoffs/api-resource-metrics.md` — the metrics design these widgets read.
