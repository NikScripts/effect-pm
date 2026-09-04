{#managing-layers title="Managing Layers" done="api previews types" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version has navigation, search,
> and live type previews at <https://dev.hyperlink.cool/docs/managing-layers>.
<!-- docs-site-link:end -->
# Managing Layers

A [Hyperlink Service](/docs/glossary#hyperlink-service) is defined once: a [Tag](/docs/glossary#tag)
with a [Contract](/docs/glossary#contract), and an Implementation behind it. Where it runs (and how
you reach it) is decided entirely by the [Layer](/docs/glossary#layer) you provide. The code that uses
it never changes. `yield* Tag` reads the same whether the HyperService runs in this process, is
served over RPC, or is a client to one running elsewhere.

[Core Concepts](/docs/core-concepts) covered that idea. This page is the Layer vocabulary:
in-process, served, remote, or across a fleet. [Creating a Hyperlink Service](/docs/creating-a-hyperlink)
builds one Tag end to end when you're ready.

{.note}
**The Tag is fixed. The Layer varies.** Swap in-process for remote at the composition root; leave
the consuming code alone.

## Running in-process

Run the implementation in the current runtime:

{.twoslash}
``` ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Effect, Schema, Layer } from "effect"
class Jobs extends Hyperlink.Service<Jobs>()("app/Jobs", {
  run: Hyperlink.effect(Schema.Void),
}) {}
declare const jobsImpl: Effect.Effect<{ readonly run: Effect.Effect<void> }>
declare const program: Effect.Effect<void, never, Jobs>
// ---cut---
const inProcess = Hyperlink.layer(Jobs, jobsImpl)

program.pipe(Effect.provide(inProcess)) // `yield* Jobs` runs jobsImpl locally
```

## Serving over the network

To expose a HyperService over RPC, pick a **protocol listen**. `Node.listen` is the neutral spine
(no transport bind). Day to day you call one of four siblings that share its overload family:
`Node.http`, `Node.ws`, `Node.unix`, `Node.nPipe`. Toggle the wire; every form stays the same:

``` listen
```

Pick the sibling that matches the deployment:

- **`Node.http`**: RPC over HTTP POST. Default for servers, CLIs, and a handful of streams.
- **`Node.ws`**: one multiplexed WebSocket per client. Prefer for browsers: many live streams
  starve under HTTP/1.1's ~6 connections per origin.
- **`Node.unix`** / **`Node.nPipe`**: same-machine IPC (Unix socket / Windows named pipe).

Omit the address for an ephemeral bind. Pass a port, `":port"`, or url for HTTP/WebSocket; pass a
path for IPC. Object form (`{ port, url, unlink, … }`) remains when you need more than the address.

Nameless listens Soft-bake `Lookup.layer` when identity is not already in the environment. Override
with `Layer.provide(Lookup.layerOptions({ path }))` (or `Lookup.client` / `Lookup.layerNode`) when it
is.

Every listen auto-mounts `Node.status` and `/health`.

{.note}
`Node.httpServer` / `Node.wsServer` are escape hatches for a custom platform bind (non-loopback host,
your own `HttpServer` layer, dual-protocol on one process). Prefer `Node.http` / `Node.ws` for the
common case.

## Connecting a client

Serving's mirror: a remote HyperService needs the client [Handle](/docs/glossary#handle) for the Tag
and a **transport** to the [Node](/docs/glossary#node) that runs it. A Node is a named endpoint that
carries the address. Nameless listens stamp that address for you; a `Node.Service` makes it
self-describing in source.

``` ts
// Same bare port as Node.http(Jobs, jobsImpl, 3000)
program.pipe(Effect.provide(Hyperlink.connect(Jobs, Hyperlink.protocolHttp(3000))))

// Or declare a node with that port and share the transport across clients
class JobsNode extends Node.Service<JobsNode>()("jobs", 3000) {}
const transport = Hyperlink.http(JobsNode)
const appLayer = Layer.mergeAll(
  transport,
  Hyperlink.client(Jobs).pipe(Layer.provide(transport)),
)
```

Two client families:

- **`Hyperlink.connect(tag, protocol)`**: you pass the wire (`protocolHttp` / `protocolWebsocket` /
  `protocolIpc`). No node required. Browser-safe: only the protocol you pass is bundled.
- **`Hyperlink.http` / `ws` / `unix` / `nPipe(node)`**: batteries included. The wire is in the name;
  the node supplies the address. Share that layer with every `Hyperlink.client(tag)` on the same
  connection.

Bare ports resolve through `HYPERLINK_CLIENT_HOST` (default `localhost`), so
`protocolHttp(3000)` / `protocolWebsocket(3000)` match a listen on `3000`. Prefer WebSocket in the
browser (`Hyperlink.ws(node)` or `connect(tag, protocolWebsocket(port))`); HTTP starves at the
~6-connection cap.

**Client and server must speak the same wire.** A `ws` client cannot talk to an `http` server.

Those shortcuts sit on one seam: a transport is an `RpcClient.Protocol` layer, and
`Hyperlink.layerProtocol(protocol)` makes it the ambient client wire that nodeless
`Hyperlink.client(tag)` calls (and peer folds) read. You rarely reach for `layerProtocol` directly;
it is there for custom serialization or a hand-rolled transport.

``` ts
Effect.provide(app, Hyperlink.layerProtocol(Hyperlink.protocolWebsocket(3000))) // one wire, whole app
```

### Lookup dial (no named Node)

When Lookup owns placement, dial with **`Hyperlink.lookupClient(Tag)`** instead of naming a
Node. Pipe `Lookup.layer` / `Lookup.client`. Dial behaviour (sticky dual-serve, stream gap,
cold N&gt;1) is [Policy](/docs/policy) — compose with `LookupPolicy.provide`:

```ts
import * as LookupPolicy from "hyperlink-ts/LookupPolicy"
import * as Lookup from "hyperlink-ts/Lookup"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Layer } from "effect"

Hyperlink.lookupClient(Jobs).pipe(
  LookupPolicy.provide(LookupPolicy.sticky, LookupPolicy.streamGap("stall")),
  Layer.provide(Lookup.layer),
)
```

Full recipe: [Identity coordinator](/docs/identity-coordinator). Runnable:
`pnpm run example:node-policy-lookup-cutover`.

### Default-on client verify

Addressed `Hyperlink.client` / `Hyperlink.ws` **probe the peer before the handle is usable**
(`LookupPolicy.verifyReject` by default). Nested / bootstrap dials use `LookupPolicy.verifyOff`.
Nodeless `Hyperlink.connect(tag, protocol)` does not probe — call
`Hyperlink.verifyConnection` yourself when you want fail-fast there.

```ts
Hyperlink.client(Emails, WorkerNode).pipe(LookupPolicy.provide(LookupPolicy.verifyOff))
```

Guide: [Client verify](/docs/client-verify). Example: `pnpm run example:node-verify-connection`.

## Dependencies on the server

A HyperService may depend on other Effect services, including other HyperServices.
`Hyperlink.serve` / `serveRemote`, the included HyperService serves (`WorkPool.serve`, `Daemon.serve`,
`Gate.serve`), and the protocol listens **preserve that requirement `R`**. They do not close
dependencies at the server boundary. Composition matches Effect's `Layer.mergeAll`: list the serve
layers, then `Layer.provide` what they need outside.

Provide a shared dependency once onto the whole server:

``` ts
Node.http(
  [
    WorkPool.serve(Emails, { effect: sendEmail }),
    Daemon.serve(Digest, { effect: fillQueue }),
  ],
  3000,
).pipe(Layer.provide(Db.layer))
```

When two HyperServices on one `/rpc` need mutually exclusive implementations of the same dependency,
provide onto each serve layer:

``` ts
Node.http(
  [
    Hyperlink.serveRemote(Matches, impl).pipe(Layer.provide(plainHandlers)),
    Hyperlink.serveRemote(Import, impl).pipe(Layer.provide(hookedHandlers)),
  ],
  3000,
)
```

`Hyperlink.provide(dep, [serveA, serveB])` is sugar for "these HyperServices, on this dependency."
Engine tags use `WorkPool.serve` / `Daemon.serve` / `Gate.serve` (they also run the worker or tick);
`Hyperlink.serve` / `serveRemote` only mount handlers. See `examples/scenarios/serve-per-deps.ts`.

## Fleets and peers

When a HyperService runs across many Nodes and its instances coordinate (see
[Fleets & Peers](/docs/fleets-and-peers)), **server-to-server** peer calls have their own transport.
`Hyperlink.peersLayer(tag, ThisNode)` discharges the mesh.

**Fixed** membership: stamp `Hyperlink.nodes([…])`. **Directory** membership: bare
`Hyperlink.distributed` / `nodes([])` — `peersLayer` reads Lookup’s Directory and
**hot-rebinds** on dial move / join / leave (same build-then-swap + retry as
`lookupClient`). Pipe `Lookup.client` on the listen. Runnable:
`pnpm run example:node-peers-layer-rebind`.

Peer dials default to HTTP, so a fleet whose Nodes serve WebSocket must move the peer mesh onto
WebSocket too: one knob per Node.

``` ts
Node.ws([Hyperlink.serve(WorkerPool, poolImpl)], 3000).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, ThisNode)),
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)), // peers speak ws too
)
```

Without it, a websocket-served fleet's fold (`fleetActive`, `activeByNode`, …) reaches a ws-only
`/rpc` over HTTP and 404s, silently collapsing to own-node values. Peer urls stay on the nodes;
`layerPeerProtocol` only chooses *how* to dial them.

## Picking the wire

| | Server | Client | Peers |
|---|---|---|---|
| **HTTP** (default) | `Node.http(tag, impl, 3000)` | `connect(tag, protocolHttp(port))` / `http(node)` | default |
| **WebSocket** (browser, many streams) | `Node.ws(tag, impl, 3000)` | `ws(node)` / `protocolWebsocket(port)` | `layerPeerProtocol(protocolWebsocket)` |
| **IPC** (same machine) | `Node.unix(tag, impl)` / `nPipe` | `unix(node)` / `nPipe(node)` / `protocolIpc` | |

Pick per **deployment**, not per call. Every side of one wire must agree. In-process HyperServices
(`Hyperlink.layer`) have no transport at all.

## Next

Build one Tag end to end in **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**, or go
deeper on multi-node coordination in **[Fleets & Peers](/docs/fleets-and-peers)**.

When Lookup owns placement / cutover: **[Identity coordinator](/docs/identity-coordinator)** ·
**[Policy](/docs/policy)** · **[Client verify](/docs/client-verify)**. OS bring-up:
**[Launcher](/docs/launcher)**.
