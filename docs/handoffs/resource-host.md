# Resource Host — design (locked) + transport validation

**Goal:** ship **only the Tag**. The host (connection info) lives *in the Tag*, so a
consumer gets a tag + a **universal** `Resource.client` (no per-resource client layer to
package) and one config-keyed transport layer per host. `Resource.client(tag)` resolves
*where* to connect from the tag's host.

Build **Effect-native** — thin wrappers over `effect/unstable/rpc` + `effect/unstable/http`
transport layers. Do **not** reinvent transport.

## Shape (host in the Tag)

- **`Resource.Host("edge")`** — declares a host; a `Context.Service` whose value is an
  `RpcClient.Protocol["Service"]` (the transport for that host). `class EdgeHost extends
  Resource.Host("edge") {}`.
- **Host on the Tag, optional** — `Resource.Tag(id, EdgeHost)` /
  `QueueResource.Tag<Self>()(id, schema, EdgeHost)`. Omit → **local-only** (no client/server;
  ties into the `LocalCapability` model). Stored under a `hostSym`.
- **`Resource.host(EdgeHost, config)`** — wires the host's transport **once**, config-keyed
  (url from `Config`, env-portable). Provides `EdgeHost` = the client `Protocol` built from
  the http layers below, re-keyed under the host. `Resource.hostLocal(EdgeHost)` points it at
  the in-process server instead.
- **`Resource.client(tag)`** — universal; reads `tag`'s host, and its `R` = that host. It
  obtains the host's `Protocol` service value and provides it locally as
  `RpcClient.Protocol` to `RpcClient.make(group)` (`Effect.provideService`). Multi-host works
  because each host re-keys its own `Protocol`; provide each `Resource.host(...)` once.

The host is **Tag metadata** (like `groupId`/`spec`) — `yield* Tag` and `ServiceOf` are
unchanged; the clean service types are unaffected.

## Effect-native transport layers (confirmed in effect@4.0.0-beta.69)

- **Client:** `RpcClient.layerProtocolHttp({ url })` → `Layer<RpcClient.Protocol, never,
  RpcSerialization | HttpClient>`; or `RpcClient.makeProtocolHttp(httpClient)` →
  `Effect<Protocol["Service"], never, RpcSerialization>` (use this to re-key under a host).
- **Serialization:** `RpcSerialization.layerJson` / `layerNdjson` / `layerMsgPack` (client
  and server must match).
- **Server:** `RpcServer.layerHttp({ group, path })` (registers on `HttpRouter`) +
  `HttpRouter.serve(appLayer)` + an `HttpServer`. Handlers via `group.toLayer({...})`.
- **HttpClient:** `effect`'s `FetchHttpClient.layer` or `@effect/platform-node`'s
  `NodeHttpClient`.

## Test vehicle

`@effect/platform-node`'s **`NodeHttpServer.layerTest`** — provides an in-process
`HttpServer` **and** a wired `HttpClient`, so a real http round-trip needs no manual port
binding.

## Validation status (scratch, not committed)

A scratch round-trip **compiles** and the **server starts** (`Listening on …`), confirming
the layer wiring is correct and Effect-native:

```ts
const ServerLive = HttpRouter.serve(
  RpcServer.layerHttp({ group: Group, path: "/rpc" }).pipe(
    Layer.provide(Group.toLayer({ ping: () => Effect.succeed("pong") })),
  ),
);
const TestEnv = Layer.mergeAll(ServerLive, RpcClient.layerProtocolHttp({ url: "/rpc" })).pipe(
  Layer.provideMerge(RpcSerialization.layerJson),
  Layer.provideMerge(NodeHttpServer.layerTest),
);
```

**Open detail to resolve first:** the client request fails with an empty `RpcClientError:
HttpError`. The server listens on a random port; the relative client `url: "/rpc"` likely
isn't resolving against `layerTest`'s HttpClient (needs the server's absolute base URL, or a
`layerTest`/`HttpClient` base-URL config, or the RPC route path doesn't match). Resolve this
small transport-config detail, then formalize `Resource.Host` / `Resource.host` /
`Resource.client(tag)` on top.

## Then

Health (`ping`/`health`/`inventory`/`contractHash`, see `resource-host-health.md`) lands as
a reserved-prefix resource once Host exists.
