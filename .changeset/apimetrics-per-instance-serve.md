---
"@nikscripts/effect-pm": minor
---

**ApiMetrics is now a per-instance resource that serves on a host like queues/processes (BREAKING).** Previously `ApiMetrics` used one shared RPC group (`tagFor` + `serveInstances`/`clientInstances`, routed by a key header), which didn't compose with `serveAllHttp` — so a `connectHttp`'d dashboard couldn't read API-usage panels over the same transport. Each `ApiMetrics` tag now has its **own per-instance RPC group** and can bind to a `Resource.Host`:

```ts
class SdpMetrics extends ApiMetrics.Tag<SdpMetrics>()("nwslsoccer-sdp", { host: NwslHost }) {}

Resource.serveAllHttp([
  QueueResource.serverEntry(RosterQueue, { effect }),
  ApiMetrics.serverEntry(SdpMetrics), // ✅ fed from the Metric registry (instrumentEndpoints)
]);
// dashboard: Resource.client(SdpMetrics) over the host — the ApiCard/charts light up.
```

- **New:** `ApiMetrics.Tag<Self>()(clientId, { host?, description? })` (host-bearing returns `ApiMetricsHostTag`, so `Resource.client` resolves the transport and the tag can be `export`ed); `ApiMetrics.serverEntry(tag)` → a `ServeEntry`. Host-bound tags are keyed per-host (`<hostKey>/<clientId>/metrics`), so two hosts serving the **same** `clientId` don't collide.
- **Removed:** `ApiMetrics.serveInstances`, `ApiMetrics.clientInstances`, `ApiMetrics.instance` (the shared-group family). Migrate to `serveAllHttp([ApiMetrics.serverEntry(tag), …])` + `Resource.client(tag)`.
- **Unchanged:** `ApiMetrics.layer` / `ApiMetrics.layerFor` (run it locally, fed from the registry), `clientIdOf`, `metricsKeyFor`, the wire schemas.
