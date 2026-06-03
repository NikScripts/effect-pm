---
"@nikscripts/effect-pm": minor
---

Add `StoreTransportRpc` — registry-direct RPC transport for `ProcessStore` facet queries.

**New exports:**

- `StoreTransportRpc` namespace — `serverLayer`, `makeClient`, `toProcessStoreQueryClient`, `layerProtocolFromRpc`, `Protocol`, `errors`
- `StoreQueryClient<R>` — typed client mapped from a `ProcessStoreRegistry`; methods are `client.RunResource.facts(payload)` / `client.for.RunResource(id).entries()`
- `StoreClientTransport` — protocol-agnostic send/sendStream interface
- `StoreClientMiddleware` — per-request client middleware
- `StoreTransportServerConfig` — server-side concurrency, tracing, middleware options
- `StoreMessage` subpath — `FromClientEncoded`, `FromServerEncoded`, `ExitEncoded`, `RequestId`, `parseTag`, `makeQueryTag`, `makeForQueryTag`
- `ProcessStorage.layerRemote(client)` — provide all six built-in facet `Query` sub-tags from a single `StoreQueryClient`

**Server usage:**
```ts
StoreTransportRpc.serverLayer(registry).pipe(
  Layer.provide(StoreTransportRpc.layerProtocolFromRpc),
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/store" })),
  Layer.provide(RpcServer.layerNdjson),
)
```

**Client usage:**
```ts
const client = StoreTransportRpc.makeClient(
  ProcessStore.registry([RunResourceStore, QueueResourceStore]),
  transport,
)
RunResourceStore.layerRemote(StoreTransportRpc.toProcessStoreQueryClient(client))
// or for all facets at once:
ProcessStorage.layerRemote(client)
```
