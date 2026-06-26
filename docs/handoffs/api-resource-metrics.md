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

### 1. Usage metrics (primary)
Every request already funnels through the gated `HttpClient`, so the gate transform is the natural
instrumentation point. Add a metrics middleware (a second `HttpClient.transform` wrapping the gated
client) recording, labeled by client `name`:
- `api_requests_total` (counter), `api_in_flight` (gauge ±1 around each request),
- `api_request_duration` (histogram), `api_responses_total` by status class / `api_errors_total`.

Decisions to make:
- **Granularity:** transport-level (per-client + per-status + latency) is easy and the right v1.
  **Per-endpoint** labels need instrumenting at the `HttpApiClient` dispatch (not the transport) and
  raise cardinality — defer, or derive from the `HttpApi` endpoint name, not the raw URL.
- **Surface:** v1 = Effect `Metric.*` (global registry, labeled). v2 (for the dashboard) = a
  per-resource observable like the queue's `.metrics` (windowed) / `.status` (in-flight now). Mirror
  `QueueContract`'s metrics shape so the **UI agent** can reuse the dashboard data layer.

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
