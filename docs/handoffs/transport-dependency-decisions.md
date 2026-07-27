# Protocol as a dependency — a `Protocol` provider service

Layers stay transport-agnostic; the protocol is an injected dependency.

**Status:** IMPLEMENTED on `feat/protocol-dependency`. Final shape (owner-directed, differs from the
early drafts below): the standard seam is **`Hyperlink.layerProtocol(protocol)`** where `protocol` is
effect's own `RpcClient.Protocol`; helpers **`protocolHttp(url)` / `protocolWebsocket(url)`** build the
common ones, and **`socketClient` / `httpClient`** are per-node shortcuts over it. The server mirrors
those named shortcuts: **`httpServer([...])`** (http) and **`wsServer([...])`** (websocket) — no
`protocol` option (an earlier draft had one; the owner rightly called it out as clunky/asymmetric).
Peers read an injected builder via **`layerPeerProtocol(builder)`** (a Context.Reference
defaulting to `protocolHttp`, so http fleets are unchanged). No `Transport` service, no per-protocol
layers. Verified: full gate green, `WorkerPool` folds to 12 over ws in `examples/hyperlink-web`, new
`test/multi-host-peers-protocol.test.ts`. The sections below are the design history that led here.

## The problem this fixes

`buildPeerClient` (`src/Hyperlink.ts:3597`) hardcodes `RpcClient.layerProtocolHttp`. The server
(`httpServer({ protocol })`) and the client (`socketClient` vs `httpClient`) each bake their own
protocol separately. **No single place** says "this deployment speaks WebSocket." So when the example
servers moved to `protocol: "websocket"` (the browser streaming fix — HTTP/1.1's ~6-connection cap
starves node streams), the server↔server **peer mesh broke silently**: a websocket `/rpc` returns
**404** to the HTTP POST `buildPeerClient` sends, every peer read fails, and `fleetActive` /
`activeByNode` collapse to the local value. The `WorkerPool` widget renders "1 node · fleet 5"
instead of "3 nodes · fleet 12".

## What effect already gives us

Both sides of effect's RPC are **already protocol-agnostic with a `Protocol` dependency** — we've
been baking over it:

- **Client:** `RpcClient.make(group): Effect<Client, never, Protocol | …>`. Provided by
  `layerProtocolHttp({ url })` (needs `HttpClient` + serialization) or `layerProtocolSocket()` (needs
  `Socket` + serialization).
- **Server:** `RpcServer.layer(group): Layer<never, never, Protocol | handlers>`. Provided by
  `RpcServer.layerProtocolHttp({ path })` / `layerProtocolWebsocket({ path })` (register on the
  ambient `HttpRouter`).
- **The node tag is already the client-protocol dependency:** `connect(node, proto)`
  (`Hyperlink.ts:3333`) stores an `RpcClient.Protocol` as the node's value; `client(tag, node)` reads
  it via `yield* node` (`Hyperlink.ts:3871`). Direct clients are already agnostic-with-a-dependency.

The gap: **peers** don't use that mechanism, the **server** bakes an enum, and there's **no single
knob** — the effect `Protocol` is per-endpoint (one url / one path), so one ambient value can't cover
a fleet.

## The design — a `Protocol` provider service

One deployment-level service, holding two provider functions over effect's own constructors. It's the
"service that takes the protocol dep and provides it for each" — given a node's url or a server path,
it yields effect's `Protocol`.

```ts
// src/Hyperlink.ts (public)
export interface Protocol {
  /** effect's client Protocol for one endpoint url — peers/clients call this per node. */
  readonly client: (url: string) => Layer.Layer<RpcClient.Protocol>
  /** effect's server Protocol on the ambient HttpRouter at path. */
  readonly server: (path: string) => Layer.Layer<RpcServer.Protocol, never, HttpRouter.HttpRouter>
}

// A process-global default via Context.Reference (the registry pattern) — defaults to HTTP, so an
// existing http deployment that provides nothing keeps working unchanged.
export class ProtocolTag extends Context.Reference<ProtocolTag>()(
  "hyperlink-ts/Protocol",
  { defaultValue: (): Protocol => httpProtocol },
) {}

// The two shipped implementations — each `.client`/`.server` returns effect's OWN Protocol, wired.
export const httpProtocol: Protocol = {
  client: (url) => RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(defaultSerialization), Layer.provide(FetchHttpClient.layer)),
  server: (path) => RpcServer.layerProtocolHttp({ path }).pipe(Layer.provide(defaultSerialization)),
}
export const websocketProtocol: Protocol = {
  client: (url) => RpcClient.layerProtocolSocket().pipe(
    Layer.provide(defaultSerialization),
    Layer.provide(Socket.layerWebSocket(Effect.sync(() => toWebSocketUrl(url)))),
    Layer.provide(Socket.layerWebSocketConstructorGlobal)),
  server: (path) => RpcServer.layerProtocolWebsocket({ path }).pipe(Layer.provide(defaultSerialization)),
}

// provide ONE at the root (http is the default, so only ws needs this):
export const layerWebsocket: Layer.Layer<never> = Layer.succeed(ProtocolTag, websocketProtocol)
export const layerHttp: Layer.Layer<never>      = Layer.succeed(ProtocolTag, httpProtocol)
```

### The three call-sites consult the service (no baking, no options)

```ts
// SERVER — httpServer reads ProtocolTag, applies .server(path). Was: RpcServer.layerHttp({protocol}).
const proto = yield* ProtocolTag
RpcServer.layer(merged).pipe(
  Layer.provide(nodeTag[groupSym].toLayer(nodeHandlers)),
  Layer.provide(proto.server(options?.path ?? "/rpc")),
)

// CLIENT (per node) — connect reads ProtocolTag + node.url. socketClient/httpClient become redundant.
const connect = (node) => Layer.effect(node, Effect.map(ProtocolTag, (p) => /* build */ p.client(node.url)…))

// PEERS — peersLayer reads ProtocolTag, applies .client(peer.url) for each peer in the fleet.
const proto = yield* ProtocolTag
Effect.forEach(others, (peer) => buildPeerFrom(tag, proto.client(peer.url)))
```

`peersLayer` keeps **auto-connecting from the `distributed` set** (today's ergonomics — no per-peer
`connect`), but the protocol it uses comes from the injected service, not a hardcoded
`layerProtocolHttp`. Its `options.url` override (per-node url from `Config`) stays; only the baked
protocol goes.

### SSOT + zero-break

- **One provide** (`layerWebsocket`) at the root → server serves ws, every client dials ws, the peer
  mesh dials ws. No 404, `fleetActive` = 12.
- **`Node.url`** stays the single canonical `http://…` address; `websocketProtocol.client` applies the
  `ws://` scheme via the existing `toWebSocketUrl`. The node says *where*; the service says *how*.
- **HTTP is the `Context.Reference` default** → an existing deployment that provides nothing is
  unchanged. Only ws deployments add the one provide.

## Open decisions (need owner input)

1. **Name.** `Protocol` collides with effect's `RpcClient.Protocol` / `RpcServer.Protocol`. Options:
   `Hyperlink.Protocol` (ours, qualified) · `Hyperlink.Transport` · `Hyperlink.Wire`. Lean **`Transport`**
   to avoid the collision. Your call.

2. **Migration of the shipped baked forms.**
   - `httpServer({ protocol })`: drop the `"http" | "websocket"` option (read the service instead).
   - `socketClient` / `httpClient`: become redundant (provide `layerWebsocket` + use plain `client`).
     Keep as thin sugar, or remove (beta)? Lean **remove** — the service is the way, and the http
     default means the common case needs nothing.
   Either way the **http default keeps non-ws apps working with no change**; only ws apps migrate (one
   provide).

3. **Does the service carry `server` too, or only `client`?** Server protocol is one provide per
   `httpServer` already, so bundling `server` into the service is for *symmetry/SSOT* (one knob covers
   serving AND dialing), not necessity. Lean **carry both** — one `layerWebsocket` makes the whole
   deployment coherent.

4. **Branch.** Fresh from `main` (transport work, orthogonal to dashboard-widgets), then the
   `WorkerPool` card re-lands on top. Lean **yes**.

## Verification plan (once approved)

- Full gate: tsgo ×2 + tsc + LSP + markers + tests.
- New test: multi-node peer fold over **websocket** (the gap `multi-node-peers-http.test.ts` never
  covered) → `fleetActive` = 12, `activeByNode` = 3 rows. Plus: default (no provide) still http.
- Screenshot: `WorkerPool` card shows "3 nodes · fleet 12".
- Docs sweep: dashboard/transport guidance becomes "provide `Hyperlink.layerWebsocket` at the root,"
  not "use `socketClient` in the browser."
