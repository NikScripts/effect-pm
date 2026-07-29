# API changes you should know — 2026-07-16

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Everything below is on `integration`. **★ = breaking.** Grouped by what you'd actually change in your code.

## Transport is now derived from the node — you can't dial the wrong protocol

A `Hyperlink.Node` carries **how** to reach it, not just where:

```ts
type ProtocolKind = "http" | "socket";

class Droplet extends Hyperlink.Node<Droplet>("droplet", 7777) {}                   // kind "http" (port)
class Live    extends Hyperlink.Node<Live>("live", { url: "wss://live/rpc" }) {}     // kind "socket" (inferred)
class Push    extends Hyperlink.Node<Push>("push", { url: "/rpc", kind: "socket" }) {} // explicit for a path
```

`Hyperlink.connect` is now **dual** and derives the transport from the node's `kind`:

```ts
Droplet.pipe(Hyperlink.connect)              // derives http/socket from the node — mismatch is impossible
Droplet.pipe(Hyperlink.connect(protocol))    // data-last: an explicit RpcClient.Protocol
Droplet.pipe(Hyperlink.connectHttp)          // kind shortcuts (Effect's Http / Socket vocab)
Droplet.pipe(Hyperlink.connectSocket)
Hyperlink.connect(Droplet) / connect(node, protocol)   // data-first
```
A node with **no** declared address throws `UnaddressedNode` at connect (was silent). The names follow Effect exactly (`connectHttp`/`connectSocket`, matching `layerProtocolHttp`/`layerProtocolSocket`).

## New: eager reachability check (+ deep classification)

```ts
yield* Hyperlink.verifyConnection(Droplet)                       // NodeUnreachable if the peer is down
yield* Hyperlink.verifyConnection(Droplet, { url: "/rpc", timeout: "1 second" })
yield* Hyperlink.verifyConnection(Droplet, { deep: true })       // + NodeStatus RPC
yield* Hyperlink.verifyConnection(Droplet, { deep: true, resource: "app/Emails" })
// → ProtocolUnanswered | ServiceNotServed | ServiceNotReady
```
Tier-1 is a cheap transport probe (`selectEndpoint`, or `{ all: true }`). `{ deep: true }` dials auto-served `NodeStatus`. Escape-hatch http→ws calls also remap to tagged `ProtocolMismatch` (not an opaque `RpcClientDefect`). Nodeless `client(tag)` without ambient Protocol fails as tagged `MissingClientProtocol`.

## ★ A node is no longer a bare protocol — the wiring bug is now a compile error

The dashboard's "connecting… forever" bug (`client(nodelessTag).pipe(provide(node))`) used to type-check and then throw at runtime. A node's value is now a wrapper, so:

```ts
Hyperlink.client(NodeStatus.Tag).pipe(Layer.provide(node))   // ★ now a COMPILE ERROR
Hyperlink.client(NodeStatus.Tag, node)                       // ✅ the correct form (reads + unwraps the node)
```
**If you read a node's value as a protocol directly** — `Layer.effect(RpcClient.Protocol, node)` — that no longer compiles. Use `Hyperlink.client(tag, node)`.

## ★ The http transport dies in a browser (was a warning)

```ts
Hyperlink.httpClient(node) / clientHttp / connectHttp / protocolHttp   // in a browser → dies (HttpClientInBrowser)
Hyperlink.socketClient(node)                                          // ✅ the browser transport
```
The http transport starves at the browser's ~6-connection cap and shipped a blank dashboard; that's now a loud death, not an ignorable warning. **No-op in Node** (servers/tests/CLI unaffected).

## Reminder (landed slightly earlier, in case you missed it)

- `Hyperlink.wsServer([...])` is the WebSocket server — replaced `httpServer(..., { protocol: "websocket" })`.
- Client protocols: `Hyperlink.protocolHttp(url)` / `Hyperlink.protocolWebsocket(url)`.

## Not changing (so you don't wonder)

- **Loose-fields payloads were already rejected** — `WorkPool.Tag(...)({ payload: Schema.Struct({...}) })` is required; `{ payload: { …fields } }` and bare `{ …fields }` don't compile. (No change this cycle; noting it because it was on the "impossible" list and turned out already-enforced.)
- `connectFleet` was **not** shipped (a cast-free version wasn't reachable; the manual `Layer.mergeAll(transport, client(A).pipe(provide(transport)), …)` stays the blessed, type-safe pattern).
