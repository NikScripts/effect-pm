{#managing-layers title="Managing Layers" status="draft" done="api previews types" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/managing-layers>.
<!-- docs-site-link:end -->
# Managing Layers

A [**Hyperlink Service**](/docs/glossary#hyperlink-service) is defined **once** — a Tag with a
Contract, and an Implementation behind it. Where it runs and how you reach it is decided entirely by
the [**Layer**](/docs/glossary#layer) you provide. The code that uses it never changes: `yield* Tag`
reads the same whether the HyperService runs in this process, is served over RPC, or is a client to
one running elsewhere.

[Core Concepts](/docs/core-concepts) covered that idea. This page is the Layer vocabulary —
in-process, served, remote, or across a fleet. [Creating a Hyperlink Service](/docs/creating-a-hyperlink)
builds one Tag end to end when you're ready.

{.note}
The rule of thumb: **the Tag is fixed, the Layer varies.** Swapping a resource from in-process to
remote is a change at the composition root, not in the consuming code.

## Running in-process

The simplest layer runs the Implementation in the current runtime:

``` ts
const JobsLive = Hyperlink.layer(Jobs, jobsImpl)

program.pipe(Effect.provide(JobsLive)) // `yield* Jobs` now runs jobsImpl locally
```

## Serving over the network

To expose a HyperService over RPC, use a **protocol listen**. All four siblings share one overload
family — `Node.http` / `Node.ws` / `Node.unix` / `Node.nPipe` — differing only in the wire.

**One HyperService** — pass Tag + impl (no `Hyperlink.serve`, no brackets). Omit the address for an
ephemeral bind; nameless listens Soft-bake `Lookup.layer` when you don't provide one:

``` ts
Node.http(Jobs, jobsImpl)            // nameless, ephemeral port, Lookup Soft-baked
Node.http(Jobs, jobsImpl, 3000)      // or ":3000" or "http://127.0.0.1:3000/rpc"
Node.http(Jobs, jobsImpl, Worker)    // named Node (no andNode)
Node.unix(Jobs, jobsImpl)            // same-machine ipc, ephemeral sock
Node.unix(Jobs, jobsImpl, "/tmp/jobs.sock")
```

**Several on one `/rpc`** — list serve layers; brackets optional when there's only one:

``` ts
Node.http(
  [
    Hyperlink.serve(Jobs, jobsImpl),
    Hyperlink.serve(Emails, emailsImpl),
  ],
  3000,
)

Node.http(Hyperlink.serve(Jobs, jobsImpl), 3000) // one serve, no array
Node.http(Worker, Hyperlink.serve(Jobs, jobsImpl), 3000)
```

Which listen:

- **`Node.http`** — RPC over HTTP POST. Default for servers, CLIs, and a handful of streams.
- **`Node.ws`** — one multiplexed WebSocket per client. Prefer for **browsers** (many live streams;
  HTTP/1.1's ~6 connections per origin starves the rest).
- **`Node.unix`** / **`Node.nPipe`** — same-machine IPC (path string or omit for ephemeral).

Address shorthand matches `Node.Tag` / `protocolHttp`: port, `":port"`, or a full url (ipc: a path
string). Object form (`{ port, url, unlink, … }`) remains when you need more than the address.
Override Lookup with `Layer.provide(Lookup.layerOptions({ path }))` when Identity is already in env.

Every listen auto-mounts `Node.status` and `/health`. Clients dial the same address:

``` ts
program.pipe(Effect.provide(Hyperlink.connect(Jobs, Hyperlink.protocolHttp(3000))))
```

{.note}
`Node.httpServer` / `Node.wsServer` remain as escape hatches for a custom platform bind (non-loopback
host, your own `HttpServer` layer, dual-protocol on one process). Prefer `Node.http` / `Node.ws` for
the common case.

## HyperServices may require other services

A HyperService may depend on other Effect services — including other HyperServices.
`Hyperlink.serve` / `serveRemote`, engine forms (`WorkPool.serve`, `Daemon.serve`, `Gate.serve`),
and the protocol listens **preserve that requirement `R`**. They do not close dependencies at the
server boundary. Composition matches Effect's `Layer.mergeAll`: list the serve layers, then
`Layer.provide` what they need **outside**.

**Shared dep (usual case)** — provide once onto the whole server:

``` ts
Node.http(
  [
    WorkPool.serve(Emails, { effect: sendEmail }),
    Daemon.serve(Digest, { effect: fillQueue }),
  ],
  3000,
).pipe(Layer.provide(Db.layer))
```

**Isolated deps (same tag, different impls)** — provide onto *each* serve layer when two resources
on one `/rpc` need mutually exclusive implementations of one dependency:

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

## Connecting a client

The client mirror of serving. A remote HyperService needs the client handle for the Tag and a
**transport** to the node it runs on. A [**Node**](/docs/glossary#node) is a named endpoint —
`Node.Tag<Self>()("key", { url })` — that carries the address. Nameless listens stamp that address
for you; a `Node.Tag` makes it self-describing in source.

``` ts
// One resource by port or url — batteries included (transport + client in one call):
program.pipe(Effect.provide(Hyperlink.connect(Jobs, Hyperlink.protocolHttp(3000))))

// Or wire a Node's transport once and read any resource that rides it:
const transport = Hyperlink.ws(JobsNode, { url: "/rpc" }) // WebSocket (browser)
const appLayer = Layer.mergeAll(
  transport,
  Hyperlink.client(Jobs).pipe(Layer.provide(transport)),
)
```

Per-node shortcuts, matching the server listens:

- **`Hyperlink.http(node, { url? })`** — HTTP. Server side: `Node.http`.
- **`Hyperlink.ws(node, { url? })`** — WebSocket. Server side: `Node.ws`. The `url` may be a
  same-origin path (`"/rpc"`, resolved against the page — `http→ws` / `https→wss`), an `http(s)://`
  url (scheme swapped), or an absolute `ws(s)://` url. Resolution order: option → Node url →
  `"/rpc"`.

**Client and server must speak the same wire** — a `ws` client cannot talk to an `http` server.

## The transport primitive

Those shortcuts sit on one seam. A transport is an `RpcClient.Protocol` layer;
`Hyperlink.layerProtocol(protocol)` makes it the ambient client wire that nodeless
`Hyperlink.client(Tag)` calls (and peer folds) read. Build the common ones with
`Hyperlink.protocolHttp(url)` / `Hyperlink.protocolWebsocket(url)`:

``` ts
Effect.provide(app, Hyperlink.layerProtocol(Hyperlink.protocolWebsocket())) // one wire, whole app
```

Two shapes on that seam:

- **`Hyperlink.connect(Tag, protocol)`** — client for one Tag over a protocol you pass (port, url,
  or a custom layer). No Node required.
- **`Hyperlink.http(node)` / `Hyperlink.ws(node)`** — dial a Node (wire its transport and put the
  Node in context). Share that layer with every `Hyperlink.client(Tag)` that rides the same
  connection.

You rarely reach for `layerProtocol` directly — the named shortcuts cover the common cases — but
it's there for custom serialization or a hand-rolled transport.

## Fleets and peers

When a HyperService runs across many nodes and its instances coordinate (see
[Fleets & Peers](/docs/fleets-and-peers)), **server-to-server** peer calls have their own transport.
`Hyperlink.peersLayer(Tag, ThisNode)` discharges the mesh; peer dials default to HTTP, so a fleet
whose nodes serve WebSocket must move the peer mesh onto WebSocket too — one knob per node:

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
| **IPC** (same machine) | `Node.unix(Tag, impl)` | `unix(tag)` / `protocolIpc(path)` | — |

Pick per **deployment**, not per call — every side of one wire must agree. In-process resources
(`Hyperlink.layer`) have no transport at all.

## Next

Build one Tag end to end in **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**, or go
deeper on multi-node coordination in **[Fleets & Peers](/docs/fleets-and-peers)**.
