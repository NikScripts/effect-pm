{#managing-layers title="Managing Layers" status="draft" done="api previews types" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/managing-layers>.
<!-- docs-site-link:end -->
# Managing Layers

A [**Hyperlink Service**](/docs/glossary#hyperlink-service) is defined once: a Tag with a
[**Contract**](/docs/glossary#contract), and an Implementation behind it. Where it runs (and how you
reach it) is decided entirely by the [**Layer**](/docs/glossary#layer) you provide. The code that
uses it never changes. `yield* Tag` reads the same whether the HyperService runs in this process, is
served over RPC, or is a client to one running elsewhere.

[Core Concepts](/docs/core-concepts) covered that idea. This page is the Layer vocabulary:
in-process, served, remote, or across a fleet. [Creating a Hyperlink Service](/docs/creating-a-hyperlink)
builds one Tag end to end when you're ready.

{.note}
**The Tag is fixed. The Layer varies.** Swap in-process for remote at the composition root; leave
the consuming code alone.

## Running in-process

Run the Implementation in the current runtime:

``` ts
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

Nameless listens Soft-bake `Lookup.layer` when Identity is not already in the environment. Override
with `Layer.provide(Lookup.layerOptions({ path }))` (or `Lookup.client` / `Lookup.layerNode`) when it
is.

Every listen auto-mounts `Node.status` and `/health`.

{.note}
`Node.httpServer` / `Node.wsServer` are escape hatches for a custom platform bind (non-loopback host,
your own `HttpServer` layer, dual-protocol on one process). Prefer `Node.http` / `Node.ws` for the
common case.

## Connecting a client

Serving's mirror: a remote HyperService needs the client Handle for the Tag and a **transport** to
the node that runs it. A [**Node**](/docs/glossary#node) is a named endpoint
(`Node.Tag<Self>()("key", { url })`) that carries the address. Nameless listens stamp that address
for you; a `Node.Tag` makes it self-describing in source.

``` ts
// One resource by port or url: transport + client in one call
program.pipe(Effect.provide(Hyperlink.connect(Jobs, Hyperlink.protocolHttp(3000))))

// Or wire a Node once and mount every client that rides it
const transport = Hyperlink.ws(JobsNode, { url: "/rpc" }) // browser WebSocket
const appLayer = Layer.mergeAll(
  transport,
  Hyperlink.client(Jobs).pipe(Layer.provide(transport)),
)
```

Two client families:

- **`Hyperlink.connect(Tag, protocol)`**: you pass the wire (`protocolHttp` / `protocolWebsocket` /
  `protocolIpc`). No Node required. Browser-safe: only the protocol you pass is bundled.
- **`Hyperlink.http` / `ws` / `unix` / `nPipe(node)`**: batteries included. The wire is in the name;
  the Node supplies the address. Share that layer with every `Hyperlink.client(Tag)` on the same
  connection.

For WebSocket, `url` may be a same-origin path (`"/rpc"`, resolved against the page:
`http→ws` / `https→wss`), an `http(s)://` url (scheme swapped), or an absolute `ws(s)://` url.
Resolution order: option → Node url → `"/rpc"`.

**Client and server must speak the same wire.** A `ws` client cannot talk to an `http` server.

Those shortcuts sit on one seam: a transport is an `RpcClient.Protocol` layer, and
`Hyperlink.layerProtocol(protocol)` makes it the ambient client wire that nodeless
`Hyperlink.client(Tag)` calls (and peer folds) read. You rarely reach for `layerProtocol` directly;
it is there for custom serialization or a hand-rolled transport.

``` ts
Effect.provide(app, Hyperlink.layerProtocol(Hyperlink.protocolWebsocket())) // one wire, whole app
```

## Dependencies on the server

A HyperService may depend on other Effect services, including other HyperServices.
`Hyperlink.serve` / `serveRemote`, the engine forms (`WorkPool.serve`, `Daemon.serve`, `Gate.serve`),
and the protocol listens **preserve that requirement `R`**. They do not close dependencies at the
server boundary. Composition matches Effect's `Layer.mergeAll`: list the serve layers, then
`Layer.provide` what they need outside.

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

When two resources on one `/rpc` need mutually exclusive implementations of the same dependency,
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

`Hyperlink.provide(dep, [serveA, serveB])` is sugar for "these resources, on this dependency."
Engine tags use `WorkPool.serve` / `Daemon.serve` / `Gate.serve` (they also run the worker or tick);
`Hyperlink.serve` / `serveRemote` only mount handlers. See `examples/serve-per-resource-deps.ts`.

## Fleets and peers

When a HyperService runs across many nodes and its instances coordinate (see
[Fleets & Peers](/docs/fleets-and-peers)), **server-to-server** peer calls have their own transport.
`Hyperlink.peersLayer(Tag, ThisNode)` discharges the mesh. Peer dials default to HTTP, so a fleet
whose nodes serve WebSocket must move the peer mesh onto WebSocket too: one knob per node.

``` ts
Node.ws([Hyperlink.serve(WorkerPool, poolImpl)], 3000).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, ThisNode)),
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)), // peers speak ws too
)
```

Without it, a websocket-served fleet's fold (`fleetActive`, `activeByNode`, …) reaches a ws-only
`/rpc` over HTTP and 404s, silently collapsing to own-node values. Peer urls stay on the Nodes;
`layerPeerProtocol` only chooses *how* to dial them.

## Picking the wire

| | Server | Client | Peers |
|---|---|---|---|
| **HTTP** (default) | `Node.http(Tag, impl, 3000)` | `connect(tag, protocolHttp(port))` / `http(node)` | default |
| **WebSocket** (browser, many streams) | `Node.ws(Tag, impl, 3000)` | `ws(node)` / `protocolWebsocket` | `layerPeerProtocol(protocolWebsocket)` |
| **IPC** (same machine) | `Node.unix(Tag, impl)` / `nPipe` | `unix(node)` / `nPipe(node)` / `protocolIpc` | |

Pick per **deployment**, not per call. Every side of one wire must agree. In-process resources
(`Hyperlink.layer`) have no transport at all.

## Next

Build one Tag end to end in **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**, or go
deeper on multi-node coordination in **[Fleets & Peers](/docs/fleets-and-peers)**.
