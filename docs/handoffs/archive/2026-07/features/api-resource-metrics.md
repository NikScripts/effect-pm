# Handoff: ApiResource — usage metrics + `.Tag` class + rename

Modernize the HTTP API client module: add **API-usage metrics**, give it the toolkit **`.Tag` class
pattern**, and rename `HttpApiResource` → **`ApiResource`**. Branch: `rewrite/resource-toolkit`.

## Current state (`src/HttpApiResource.ts`, ~275 lines)
- A typed HTTP API client with a **transport-level concurrency gate** (`Semaphore` via
  `HttpClientRunGate.withRunner` applied to `HttpClient.transform`).
- Surface: `HttpApiResource.make(api, { name, baseUrl, concurrency })` → a tag with `.layer`;
  `layerEffect` (gate an existing client effect); `acceptJson` (header helper).
- **Functional, not class-based** — it's `make()` returning a tag, unlike `Resource.Tag` /
  `QueueResource.Tag` / `ScheduledProcess.Tag`.
- **No metrics** — only concurrency gating.
- Exported from `src/index.ts` + a `./HttpApiResource` package subpath.

## Goals

### 1. Usage metrics (primary) — emit to the registry; the dashboard surface is `Telemetry`
**Decided:** ApiResource just **emits to the Effect `Metric` registry**; the dashboard-native,
cross-host aggregation lives in the separate **`Telemetry` resource** (see
`docs/handoffs/archive/2026-07/features/telemetry-resource.md`). Don't build a per-resource observable here.

Every request funnels through the gated `HttpClient`, so add a metrics middleware (a second
`HttpClient.transform` wrapping the gated client), recording labeled by `client` (tag id) + `status`:
- `api_requests_total` (counter), `api_in_flight` (gauge ±1 around each request),
- `api_request_duration` (histogram), `api_errors_total`.

**Granularity:** host/client/status are cheap (host comes from the Telemetry fan-out, free).
**Per-endpoint** needs instrumenting at the `HttpApiClient` dispatch (the transport sees only
method+URL; parameterized paths blow up cardinality) — stretch within v1; land client/status first.
These same labels then slice in the dashboard via `Telemetry`.

### 2. `.Tag` class pattern
Add `ApiResource.Tag` so a client is declared like every other toolkit resource:
```ts
class MyClient extends ApiResource.Tag<MyClient>()("@app/MyClient", MyApi, {
  baseUrl: "https://api.example.com", concurrency: 5,
}) {}
// MyClient.layer provides it; `yield* MyClient` is the typed client.
```
Keep `make` (functional) working or re-express it on top of `Tag`; keep `layerEffect`/`acceptJson`.
Match the `Tag`/`.layer` ergonomics of `Resource`/`QueueResource` (and the light-`Tag`-vs-engine
split if the metrics middleware adds weight).

### 3. Rename `HttpApiResource` → `ApiResource`
- Rename the module export + the `./HttpApiResource` subpath → `./ApiResource` (`package.json`
  exports + `tsup.config.ts` + `src/index.ts` barrel). Pre-1.0, so a breaking rename is a **minor**
  bump — add a changeset. (No consumer uses it yet per the consumer-dependency-surface memo, so no
  alias needed; confirm before assuming.)
- Update `docs/AGENTS.md` repo map + any guide references.

## Notes / coordination
- The metrics observable should mirror `QueueContract`'s metrics/status schemas so the **dashboard**
  gets API-usage panels for free — coordinate the wire shape with the UI agent.
- `HttpApiResource` is the **only** resource module still lacking `.Tag` — `Resource`,
  `QueueResource`, `ScheduledProcess`, `ProcessScheduleResource`, and `RunResource` all already have
  it. So this aligns the last outlier; no other module needs the same treatment.

## Files
`src/HttpApiResource.ts` (→ `ApiResource.ts`), `src/index.ts`, `package.json` (exports), `tsup.config.ts`,
a new `docs/guides/api-resource.md` (or section), tests under `test/`.

## Gate
config-1 + config-2 (`tsgo` both configs = 0), `pnpm lint`, `pnpm build`, `pnpm test`. Add a changeset
(public API: rename + new `.Tag` + metrics).
