# Handoff: serve ApiMetrics alongside a served group (one host, one transport)

Make a served host expose its **ApiMetrics** resources the same way it exposes queues/processes — so
a dashboard that `connectHttp`s the host reads API-usage panels over the same transport, with no
second mount. Today there's no clean path: `serveAllHttp` takes `ServeEntry` (queue/process
`serverEntry`) and auto-serves `HostStatus`, but **ApiMetrics is a `ResourceInstance` served by the
separate `serveInstances` RPC family** — the two don't compose on one host.

## The wall (from a real consumer)

wow-sports' services-hub serves three per-league hosts via `Resource.serveAllHttp([...serverEntry])`
behind `NwslHost` / `EbwslHost` / `WnbaHost`, on one port each, and the dashboard `connectHttp`s each
host. We already instrument the outbound clients (`HttpApiResource.instrumentEndpoints(api, client,
clientId)` → the Metric registry). To light up the dashboard's **ApiCard / ApiMetricChart**, the host
must serve the matching `ApiMetrics` resources. But:

```ts
Resource.serveAllHttp([
  QueueResource.serverEntry(RosterQueue, { effect }),
  ApiMetrics.instance(SdpApi, impl),   // ❌ ResourceInstance is not a ServeEntry ('tag' missing)
])
```

- `ApiMetrics.Tag` takes **no `host` option** (only `windowMs` / `description`), so it can't be bound
  to `NwslHost` and dropped into that host's `serveAllHttp` like the queues are.
- `ApiMetrics.serveInstances(...)` returns bare RPC handlers — mounting them on the **same**
  `HttpServer` that `serveAllHttp` already owns isn't documented, and there's no test/example that
  combines a served group with ApiMetrics on one host for a remote dashboard.

Net: adding `ApiMetrics` tags to the served `Group` (so the dashboard tree shows them) would create
**dashboard nodes with no RPC backing** — strictly worse than omitting them. So the instrumentation
emits to the registry but can never reach a *remote* dashboard.

## What we want

ApiMetrics should be a first-class member of a served host, exactly like `HostStatus` already is.
Any one of these closes it (in rough preference order):

1. **Auto-serve (preferred, mirrors HostStatus).** `serveAllHttp` discovers the `ApiMetrics` tags in
   the served `Group` (or accepts them in `entries`) and serves them on the same transport, fed from
   the local Metric registry via `ApiMetrics.layer(tag)`. Zero extra wiring — put the tag in the
   group, instrument the client, done. The dashboard's `connectHttp` + `Resource.kindOf` already
   render them.
2. **A `host` option on `ApiMetrics.Tag`** + an `ApiMetrics.serverEntry(tag)` that yields a
   `ServeEntry`, so it slots into `serveAllHttp([...])` next to `QueueResource.serverEntry`.
3. **A combine helper** — `serveAllHttp(entries, { apiMetrics: [SdpApi, …] })`, or a documented way to
   merge `ApiMetrics.serveInstances(...)` onto the `serveAllHttp` `HttpServer`/RPC router.

## Notes for the design

- **Feed from the registry, not impls.** Consumers instrument via `instrumentEndpoints(api, client,
  clientId)`; the served resource should read that `clientId`'s metrics (`ApiMetrics.layer(tag)`
  semantics), not require a hand-written `{ usageNow, metrics }` impl.
- **Same `clientId` on multiple hosts is normal.** wow-sports' SDP client is used by both the NWSL
  and EBWSL serve processes (separate registries, same `clientId` `"nwslsoccer-sdp"`). Each host
  should serve *its own* host-local metrics for that client; the tag identity is per-host (bound to
  that host), the `clientId` is just the registry key. Make sure two hosts serving the same
  `clientId` don't collide (today the resource key derives from `clientId` only).
- **Kind is already stamped** (`@nikscripts/effect-pm/ApiMetrics`, `Resource.kindOf`), so the
  dashboard renders an ApiCard for any served ApiMetrics leaf — the only missing piece is the serve.

## Consumer payoff
The moment this lands, wow-sports wires it in a few lines: define one `ApiMetrics.Tag` per
instrumented client (`nwslsoccer-sdp`, `wnba-content`/`core`/`web`), add them to the league `Group`s,
and the per-league `serveAllHttp` serves them — the dashboard's API usage / latency / error panels
light up per league (SDP rate-limit headroom, WNBA-OCP usage — the egress surface that bites us).
Cross-host rollup still rides the separate **Telemetry** track later.

## Related
- `docs/handoffs/api-resource-metrics.md` (ApiMetrics + `.Tag` + instrumentEndpoints — shipped).
- `docs/handoffs/telemetry-resource.md` (cross-host aggregation — the next layer up).
- `docs/handoffs/resource-host-health.md` (the HostStatus/health auto-serve — the precedent this
  mirrors).
- `docs/guides/setup.md` §"HostStatus … auto-served by `serveAllHttp`".
