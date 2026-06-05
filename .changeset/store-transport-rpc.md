---
"@nikscripts/effect-pm": minor
---

Add `storeTransport` — registry-direct RPC transport for `ProcessStore` facet queries, using `RpcServer.Protocol` directly (no forked protocol adapter).

**Breaking changes from the previous beta:**

- Renamed: `StoreTransportRpc` → `storeTransport` (camelCase module), subpath `@nikscripts/effect-pm/StoreTransportRpc` → `@nikscripts/effect-pm/storeTransport`
- Removed: `StoreTransportProtocol`, `layerProtocolFromRpc` (use `RpcServer.Protocol` directly)
- Removed: `StoreTransportRpc.Protocol`, `StoreTransportRpc.layerProtocolFromRpc`
- Renamed type: `storeTransportApi` → `StoreTransportApi`

**New exports (unchanged from prior beta):**

- `storeTransport` namespace — `serverLayer`, `makeClient`, `toProcessStoreQueryClient`, `errors`
- `StoreQueryClient<R>` — typed client mapped from a `ProcessStoreRegistry`
- `StoreClientTransport` — protocol-agnostic send/sendStream interface
- `StoreClientMiddleware` — per-request client middleware
- `StoreTransportServerConfig` — server-side options
- `StoreMessage` subpath — `FromClientEncoded`, `FromServerEncoded`, `ExitEncoded`, `RequestId`, `parseTag`, `makeQueryTag`, `makeForQueryTag`
- `ProcessStorage.layerRemote(client)` — provide all six built-in facet `Query` sub-tags

**Server usage:**

```ts
storeTransport.serverLayer(registry).pipe(
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: "/ws/store" })),
  Layer.provide(RpcSerialization.layerNdjson),
)
```

**Client usage:**

```ts
const client = storeTransport.makeClient(
  ProcessStore.registry([RunResourceStore, QueueResourceStore]),
  transport,
)
RunResourceStore.layerRemote(storeTransport.toProcessStoreQueryClient(client))
// or for all facets at once:
ProcessStorage.layerRemote(client)
```
