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

To expose a HyperService over RPC, use a **protocol listen**. `Hyperlink.serve(Tag, impl)` is one
served entry; `Node.http([...])` or `Node.ws([...])` hosts a list of them on one `/rpc` (with
auto-mounted `Node.status` and `/health`). Pass `port` or `url` for a fixed loopback address — omit
them for an ephemeral port:

``` ts
const server = Node.http(
  [
    Hyperlink.serve(Jobs, jobsImpl),
    Hyperlink.serve(Emails, emailsImpl),
  ],
  { port: 3000 }, // → http://127.0.0.1:3000/rpc
)
```

Two protocol listens, differing only in the wire they speak:

- **`Node.http([...], { port? | url? })`** — RPC over HTTP POST. The default for servers, CLIs, and
  a handful of concurrent streams.
- **`Node.ws([...], { port? | url? })`** — RPC over **one multiplexed WebSocket per client**. Use
  this when a **browser** connects: a dashboard opens many live streams (each resource's status +
  metrics + logs) and the browser caps at **~6 connections per origin on HTTP/1.1**, starving the
  rest. A WebSocket sidesteps the cap entirely.

Nameless listens mint an anonymous Node that still carries the address — clients dial
`Hyperlink.connect(Tag, Hyperlink.protocolHttp(3000))` (or `protocolWebsocket`) the same way.

{.note}
`Node.httpServer` / `Node.wsServer` remain as escape hatches when you need a custom platform bind
(non-loopback host, your own `HttpServer` layer, dual-protocol on one process). Prefer
`Node.http` / `Node.ws` for the common case.

## HyperServices may require other services

A HyperService is allowed to depend on other Effect services — including other HyperServices.
`Hyperlink.serve` / `serveRemote`, engine forms (`WorkPool.serve`, `Daemon.serve`, `Gate.serve`),
and `Node.http` / `ws` / `unix` / listen **preserve that requirement `R`**. They do not close
dependencies at the server boundary. Composition is the same as Effect's `Layer.mergeAll`: list the
serve layers, then `Layer.provide` what they need **outside**.

**Shared dep (usual case)** — provide once onto the whole server:

``` ts
Node.http(
  [
    WorkPool.serve(Emails, { effect: sendEmail }),
    Daemon.serve(Digest, { effect: fillQueue }),
  ],
  { port: 3000 },
).pipe(Layer.provide(Db.layer))
```

**Isolated deps (same tag, different impls)** — provide onto *each* serve layer. Use this when two
resources on one `/rpc` need mutually exclusive implementations of one dependency (e.g. plain vs
hooked handlers). Shared provide can only supply one:

``` ts
Node.http(
  [
    Hyperlink.serveRemote(Matches, impl).pipe(Layer.provide(plainHandlers)),
    Hyperlink.serveRemote(Import, impl).pipe(Layer.provide(hookedHandlers)),
  ],
  { port: 3000 },
)
```

`Hyperlink.provide(dep, [serveA, serveB])` is sugar for "these resources, on this dependency."
Engine tags use `WorkPool.serve` / `Daemon.serve` / `Gate.serve` (they also run the worker or tick);
`Hyperlink.serve` / `serveRemote` only mount handlers. See `examples/serve-per-resource-deps.ts`.

## Connecting a client

The client mirror of serving. A remote HyperService needs two things: the client handle for the Tag,
and a **transport** to reach the node it runs on. A [**Node**](/docs/glossary#node) is a named
endpoint — declared with `Node.Tag<Self>()("key", { url })` — that carries the address its
HyperServices answer at. Nameless listens stamp that address for you; a `Node.Tag` makes it
self-describing in source.

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

Per-node transport shortcuts, matching the two server listens:

- **`Hyperlink.http(node, { url? })`** — HTTP. The server side is `Node.http`.
- **`Hyperlink.ws(node, { url? })`** — WebSocket. The server side is `Node.ws`. The `url`
  may be a same-origin path (`"/rpc"`, resolved against the page — `http→ws`, `https→wss`), an
  `http(s)://` url (scheme swapped), or an absolute `ws(s)://` url. Both shortcuts resolve the `url`
  as: the option you pass → the Node's own url → `"/rpc"` (same-origin) as the final fallback.

**The client and server must speak the same wire** — a `ws` client cannot talk to an `http` server.

## The transport primitive

The shortcuts above are sugar over one seam. A transport is an `RpcClient.Protocol` layer;
`Hyperlink.layerProtocol(protocol)` makes it the ambient client wire that nodeless
`Hyperlink.client(Tag)` calls (and peer folds) read. Build the common ones with
`Hyperlink.protocolHttp(url)` / `Hyperlink.protocolWebsocket(url)`:

``` ts
Effect.provide(app, Hyperlink.layerProtocol(Hyperlink.protocolWebsocket())) // one wire, whole app
```

Two shapes sit on that seam:

- **`Hyperlink.connect(Tag, protocol)`** — client for one Tag over a protocol you pass (port,
  url, or a custom layer). No Node required.
- **`Hyperlink.http(node)` / `Hyperlink.ws(node)`** — dial a Node (wire its transport and put the
  Node in context). Share that layer with every `Hyperlink.client(Tag)` that rides the same
  connection.

You rarely reach for `layerProtocol` directly — the named shortcuts cover the common cases — but
it's there when you need a custom serialization or a hand-rolled transport.

## Fleets and peers

When a HyperService runs across many nodes and its instances coordinate (see
[Fleets & Peers](/docs/fleets-and-peers)), the **server-to-server** peer calls have their own
transport too. `Hyperlink.peersLayer(Tag, ThisNode)` discharges the mesh; those peer dials default to
HTTP, so a fleet whose nodes serve WebSocket must move the peer mesh onto WebSocket to match — one
knob per node:

``` ts
Node.ws([Hyperlink.serve(WorkerPool, poolImpl)], { port: 3000 }).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, ThisNode)),
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)), // peers speak ws too
)
```

Without it, a websocket-served fleet's fold (`fleetActive`, `activeByNode`, …) reaches a ws-only
`/rpc` over HTTP and 404s, silently collapsing to own-node values. The peer urls stay on the Nodes;
`layerPeerProtocol` only chooses *how* to dial them.

## Picking the wire

| | Server | Client | Peers |
|---|---|---|---|
| **HTTP** (default) | `Node.http([...], { port })` | `http(node)` / `connect(tag, protocolHttp(port))` | default |
| **WebSocket** (browser, many streams) | `Node.ws([...], { port })` | `ws(node)` | `layerPeerProtocol(protocolWebsocket)` |

Pick per **deployment**, not per call — every side of one wire must agree. In-process resources
(`Hyperlink.layer`) have no transport at all.

## Next

Build one Tag end to end in **[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**, or go
deeper on multi-node coordination in **[Fleets & Peers](/docs/fleets-and-peers)**.
