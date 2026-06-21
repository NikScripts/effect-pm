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

**Transport findings (worked through; URL solved, one detail left):**

1. **URL mangling — SOLVED.** `RpcClient.makeProtocolHttp` does `client.post("", …)` and
   `layerProtocolHttp` does `mapRequest(client, HttpClientRequest.prependUrl(options.url))`,
   which `joinSegments(options.url, requestUrl)`. Two traps:
   - Using `Layer.mergeAll(layerProtocolHttp, …, FetchHttpClient)` does **not** wire Fetch
     *into* the protocol — `layerProtocolHttp` then resolves the **ambient based** HttpClient
     (e.g. `layerTest`'s, base `http://host:port/`), whose base leaks into the path →
     `joinSegments("/", "http://host:port/")` = `/http://host:port/`. **Fix:** feed the
     client in with `Layer.provide`, not `mergeAll`:
     ```ts
     RpcClient.layerProtocolHttp({ url }).pipe(
       Layer.provide(RpcSerialization.layerJson),
       Layer.provide(FetchHttpClient.layer),   // non-based
     )
     ```
   - `url` must be **absolute** (read it from the server: `yield* HttpServer.HttpServer` →
     `address.port` → `http://127.0.0.1:${port}`). `joinSegments(absolute, "")` appends a
     trailing slash (`…/`), so mind the served path.
   With those, the request is clean (`POST /`, no mangling).

2. **Open: RPC route mounting (404).** With a clean `POST /`, the server returns
   `RouteNotFound` — `RpcServer.layerHttp({ group, path })` + `HttpRouter.serve(appLayer)`
   isn't matching at the served path. Next pass: confirm how `layerHttp` registers its route
   on the served `HttpRouter` (path value, default-router vs the one `HttpRouter.serve` runs,
   trailing-slash), get a green round-trip, then formalize `Resource.Host` / `Resource.host`
   / `Resource.client(tag)`.

## Then

Health (`ping`/`health`/`inventory`/`contractHash`, see `resource-host-health.md`) lands as
a reserved-prefix resource once Host exists.
