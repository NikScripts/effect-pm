{#managing-layers title="Managing Layers" status="draft" appliesTo=all}
# Managing Layers

A Resource is defined **once** — a Tag with a Contract, and an Implementation behind it. Where it
runs and how you reach it is decided entirely by the **Layer** you provide. The code that uses it
never changes: `yield* Tag` reads the same whether the Resource runs in this process, is served over
RPC, or is a client to one running on another machine. [Creating a
Resource](/docs/creating-a-resource) ran one in-process; this page tours the layers that place it
anywhere else — served, remote, or across a fleet.

{.note}
The rule of thumb: **the Tag is fixed, the Layer varies.** Swapping a resource from in-process to
remote is a change at the composition root, not in the consuming code.

## Running in-process

The simplest layer runs the Implementation in the current runtime:

``` ts
const JobsLive = Resource.layer(Jobs, jobsImpl)

program.pipe(Effect.provide(JobsLive)) // `yield* Jobs` now runs jobsImpl locally
```

## Serving over the network

To expose a Resource over RPC, mount it on an HTTP server. `Resource.serve(Tag, impl)` is one served
entry; `Node.httpServer([...])` (or `Node.wsServer([...])`) hosts a list of them on one
`/rpc`, alongside an auto-mounted `NodeStatus` and a `/health` route:

``` ts
const Node = Node.httpServer([
  Resource.serve(Jobs, jobsImpl),
  Resource.serve(Emails, emailsImpl),
]).pipe(
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
)
```

Two entry points, differing only in the RPC transport they speak:

- **`Node.httpServer([...])`** — RPC over HTTP POST. The default; correct for servers, CLIs, and
  a handful of concurrent streams.
- **`Node.wsServer([...])`** — RPC over **one multiplexed WebSocket per client**. Use this when a
  **browser** connects: a dashboard opens many live streams (each resource's status + metrics + logs)
  and the browser caps at **~6 connections per origin on HTTP/1.1**, starving the rest. A WebSocket
  sidesteps the cap entirely. Everything else — the serve list, the options, `/health` — is identical.

## Connecting a client

The client mirror of serving. A remote Resource needs two things: the client handle for the Tag, and
a **transport** to reach the node it runs on. A **Node** is a named endpoint — declared with
`Node.Tag<Self>()("key", { url })` — that carries the address its Resources answer at, so a
served tag is self-describing and a client knows where to dial.

``` ts
// One resource by port or url — batteries included (transport + client in one call):
program.pipe(Effect.provide(Resource.connect(Jobs, Resource.protocolHttp(3000))))

// Or wire a Node's transport once and read any resource bound to it:
const transport = Resource.ws(JobsNode, { url: "/rpc" }) // WebSocket (browser)
const appLayer = Layer.mergeAll(
  transport,
  Resource.client(Jobs).pipe(Layer.provide(transport)),
)
```

Per-node transport shortcuts, matching the two server entry points:

- **`Resource.http(node, { url? })`** — HTTP. The server side is `httpServer`.
- **`Resource.ws(node, { url? })`** — WebSocket. The server side is `wsServer`. The `url`
  may be a same-origin path (`"/rpc"`, resolved against the page — `http→ws`, `https→wss`), an
  `http(s)://` url (scheme swapped), or an absolute `ws(s)://` url. Both shortcuts resolve the `url`
  as: the option you pass → the Node's own url → `"/rpc"` (same-origin) as the final fallback.

**The client and server must speak the same wire** — a `ws` cannot talk to an `httpServer`.

## The transport primitive

The shortcuts above are sugar over one seam. A transport is a `RpcClient.Protocol` value, and
`Resource.layerProtocol(protocol)` makes it the ambient client wire — build the common ones with
`Resource.protocolHttp(url)` / `Resource.protocolWebsocket(url)`:

``` ts
Effect.provide(app, Resource.layerProtocol(Resource.protocolWebsocket())) // one wire, whole app
```

`Resource.connect(node, protocol)` is the per-node form (it re-keys a protocol under a node);
`ws(node)` is exactly `connect(node, protocolWebsocket(node.url))`. You rarely reach for the
primitive directly — the named shortcuts cover the common cases — but it's there when you need a
custom serialization or a hand-rolled transport.

## Fleets and peers

When a Resource runs across many nodes and its instances coordinate (see
[Fleets & Peers](/docs/fleets-and-peers)), the **server-to-server** peer calls have their own
transport too. `Resource.peersLayer(Tag, ThisNode)` discharges the mesh; those peer dials default to
HTTP, so a fleet whose nodes serve WebSocket must move the peer mesh onto WebSocket to match — one
knob per node:

``` ts
Node.wsServer([Resource.serve(WorkerPool, poolImpl)]).pipe(
  Layer.provide(Resource.peersLayer(WorkerPool, ThisNode)),
  Layer.provide(Resource.layerPeerProtocol(Resource.protocolWebsocket)), // peers speak ws too
)
```

Without it, a websocket-served fleet's fold (`fleetActive`, `activeByNode`, …) reaches a ws-only
`/rpc` over HTTP and 404s, silently collapsing to own-node values. The peer urls stay on the Nodes;
`layerPeerProtocol` only chooses *how* to dial them.

## Picking the wire

| | Server | Client | Peers |
|---|---|---|---|
| **HTTP** (default) | `httpServer([...])` | `http(node)` / `connect(tag, protocolHttp(port))` | default |
| **WebSocket** (browser, many streams) | `wsServer([...])` | `ws(node)` | `layerPeerProtocol(protocolWebsocket)` |

Pick per **deployment**, not per call — every side of one wire must agree. In-process resources
(`Resource.layer`) have no transport at all.
