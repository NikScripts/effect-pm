# Recipe: Store Transport RPC

## Goal

Build `StoreTransportRpc` — a registry-direct transport for ProcessStore facet
queries. Design mirrors Effect RPC internals (`@effect/rpc`) as closely as
possible, deviating only where our registry-driven dispatch replaces `RpcGroup`.
Code quality must meet or exceed this repo's standards.

## Non-goals

- Changing the telemetry / emit sections
- Changing `RuntimeStorage` or the spine
- Dashboard React components (downstream concern)
- JSON-RPC 2.0 compatibility
- Transferable / worker-thread support
- Per-handler `uninterruptible` (deferred — low rewrite cost, reads are safe)

## Mise en place

- Builder: `src/internal/store/service.ts`; public API: `src/ProcessStore.ts`
- Registry: `ProcessStoreRegistry` — `lookup[_processTag][method] = { payload, success, resolve }`
- `_forMethods`: identifier-bound methods — separate `forLookup` path
- Prior art: `src/ControlTransportRpc.ts`, `src/LogTransportRpc.ts`
- Effect RPC source: `repos/effect/packages/rpc/src/`

---

## Locked ingredients

### Builder (complete)
- `_processTag` — second positional arg, stamped as `static readonly _processTag: Tag`
- `ProcessStore.payload(S).success(S).resolve(fn)` chain
- `ProcessStore.for` resolver: `(id: string, s: Spine) => (payload) => Effect`
- `ProcessStore.registry([...facets])` — derives type map + runtime lookup
- `Facet.Query` sub-tag, `Facet.layerQuery: Layer<Query, never, RuntimeStorage>`
- `Facet.layerRemote(client): Layer<Query, never, never>` — registry-driven, dies for legacy-fn facets
- `Facet.forQuery(id)` — requires `Facet.Query` in context; uses `IDENTIFIER_FACTORY` on Query service

### Transport feature scope (locked 2026-06-03)
| Feature | Decision |
|---------|----------|
| Streaming (`Chunk` + `Ack` backpressure) | ✅ Include |
| Concurrency semaphore | ✅ Include |
| Tracing (span per request, client propagation) | ✅ Include — breaking wire change to add later |
| Server middleware | ✅ Include |
| Client middleware | ✅ Include — full parity with Effect RPC |
| Interrupt / cancel from client | ✅ Include |
| Defect isolation (`disableFatalDefects`) | ✅ Include |
| Graceful shutdown + disconnect cleanup | ✅ Include |
| Per-handler `fork` flag (bypass semaphore) | ✅ Include |
| Schema caching (`WeakMap` of compiled encode/decode) | ✅ Include |
| `forQuery` / identifier-bound path on wire | ✅ Include |
| `ndjson` serialization first, `msgPack` as swap-in | ✅ Include |
| Client keepalive (`Ping` / `Pong`) | ✅ Include |
| `uninterruptible` per-handler | ⏸ Deferred |
| Transferables | ❌ Skip |
| JSON-RPC 2.0 compat | ❌ Skip |
| Primary-key client-side dedup | ❌ Skip |

### Protocol abstraction (locked 2026-06-03)
- `StoreTransportProtocol` — own `Context.Tag` at `"@nikscripts/effect-pm/StoreTransport/Protocol"`, interface mirrors `RpcServer.Protocol` minus `supportsTransferables` and `initialMessage`
- `layerProtocolFromRpc: Layer<StoreTransportProtocol, never, RpcServer.Protocol>` — adapts any existing `layerProtocol*` to our tag; zero boilerplate for WebSocket / SocketServer consumers
- Custom protocol (PubNub, Kafka, etc.) implements `Layer<StoreTransportProtocol, never, never>` directly — no `RpcServer.Protocol` dependency needed
- Three transports (Control, Log, Store) coexist in one runtime on separate connections without `Protocol` tag collision
- `RpcSerialization` reused directly — stateless parsers, same tag, no wrapper needed

---

## Open recipe steps

### Step A: Wire message types (`StoreMessage.ts`) — locked 2026-06-03
- 10 message types verbatim from `RpcMessage.ts` (`Request`, `Ack`, `Interrupt`, `Ping`, `Eof`, `Chunk`, `Exit`, `Defect`, `Pong`, `ClientEnd`)
- `forQuery` encoded as tag suffix: `"${processTag}/for/${method}"` — no new message type; `id` folded into `payload` as `{ id, ...methodPayload }`
- `parseTag(tag)` helper distinguishes query vs forQuery via `"/for/"` substring
- `RequestId`: branded `bigint` internally, `string` on wire — identical to Effect RPC
### Step B: Server loop — locked 2026-06-03
- `makeNoStore(registry, options)` mirrors `makeNoSerialization` exactly in structure
- **Shared spine** — built once at server construction from `RuntimeStorage`, `runId: "store-transport"` constant; transport is read-only so `runId` is never stamped
- Request-scoped state via `FiberRef` — not in the spine; each forked request fiber gets fresh state automatically
- Schema cache: `Map<string, EntrySchemas>` keyed by `"${facet}/${method}"` string — entries are plain objects, not stable references
- `StoreError` union: `UnknownFacet | UnknownMethod | PayloadDecodeError | ResultEncodeError | StorageError` — typed in exit schema, not defects; client gets structured errors
- `parseTag(tag)` distinguishes query vs forQuery via `"/for/"` substring; `id` extracted from `payload.id` for forQuery
- Fiber management, Ack backpressure, interrupt, graceful shutdown — verbatim from `makeNoSerialization`
- Tracing: `Effect.withSpan(spanPrefix + "." + tag)` per request, span propagation from request headers
### Step C: Client shape + client middleware
### Step D: `StoreTransportProtocol` + adapters
### Step E: `ProcessStorage.layerRemote(client)` — dashboard bootstrap

---

## Prior locked steps (builder — complete)

### Step 6: `.Query` sub-tag + `layerQuery` + `layerRemote`
- `Facet.Query` — `Context.Tag` at `${id}/Query`
- `Facet.forQuery(id)` — `Effect<ForApi, never, Facet.Query>`
- `Facet.layerQuery` — `Layer<Facet.Query, never, RuntimeStorage>`
- `Facet.layerRemote(client)` — `Layer<Facet.Query, never, never>`

### Step 5: `ProcessStore.for` chain
- `ProcessStoreForMethod` — resolver `(id, s) => (payload) => Effect`
- `Facet.forSchemas` stamped on class

### Step 4: Router shape
- Two dispatch paths: `query` and `queryFor`
- Error taxonomy: `UnknownFacet`, `UnknownMethod`, `PayloadDecodeError`, `ResultEncodeError`, `StorageError`

### Step 3: Schema exposure + registry
- `Facet.schemas` / `Facet.forSchemas` — `{ payload, success }` per method
- `ProcessStore.registry` — `lookup` + `forLookup` with `{ payload, success, resolve }`

### Step 2: Chain API
- `ProcessStoreMethod<P, S>` — `{ _tag, payload, success, resolve }`
- Payload decoding in router, not resolver

### Step 1: `_processTag`
