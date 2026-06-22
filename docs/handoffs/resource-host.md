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

2. **Route mounting — SOLVED.** `RpcServer.layerHttp` defaults to **websocket**
   (`options.protocol === "http" ? layerProtocolHttp : layerProtocolWebsocket`). **Pass
   `protocol: "http"`.** With that, the toolkit round-trips over real http — see the
   committed test `test/resource-http.test.ts` (`Resource.Tag` + `Resource.server` on an
   http `RpcServer` + `Resource.client` over `RpcClient`'s http protocol, via
   `NodeHttpServer.layerTest`). Read the ephemeral port from `HttpServer.HttpServer`
   (`address._tag === "TcpAddress" ? address.port : 0` — narrow, no cast).

## Status — SHIPPED (slice 1: single-resource tags)

Host-in-tag is **built and green** for `Resource.Tag` (single resource):

- `Resource.Host<Self>(name)` — a `Context.Service` whose value is the transport
  `HostProtocol`; extend it (`class EdgeHost extends Resource.Host<EdgeHost>("edge") {}`).
- `Resource.host(Host, protocolLayer)` — re-keys an `RpcClient.Protocol` layer under the host
  (`Layer.effect(host, RpcClient.Protocol).pipe(Layer.provide(protocol))`), **cast-free**.
- Host on the tag rides the **inferring (spec) call**: `Resource.Tag<Self>(id)(spec, EdgeHost)`
  (a `<Self>`-explicit outer call can't also infer `HSelf`). Stored on every tag under
  `hostSym` as `HostKey<unknown> | undefined` (uniform → host-bearing tags stay assignable
  wherever a plain `ResourceTag` is expected — the reverted wrinkle is gone). The host-bearing
  return **narrows** `[hostSym]` to a concrete `HostKey<HSelf>`.
- `Resource.client(tag)` — **two overloads** (no breaking change, per the owner's call):
  - host-bearing tag → `Layer<Self, never, HSelf>` (transport resolved from the tag's host;
    ship only the tag);
  - hostless tag → `Layer<Self, never, RpcClient.Protocol>` (ambient transport, as before).
  One contained boundary cast in the host branch (the base tag erases `HSelf` to `unknown`;
  the overload pins it for callers) — consistent with the file's other runtime-safe boundary
  assertions.
- Tests: type-level proofs in `test/resource.test-d.ts` (host-bearing client requires the
  host; `Resource.host` re-keys; full wiring → `R = never`) + a **real-http** round-trip
  shipping only the tag + `Resource.host(...)` in `test/resource-host-http.test.ts`.

## Status — SHIPPED (slice 2: families + queues)

Host now threads through factories too:

- `Resource.tagFor(groupId, spec, { host: EdgeHost })` → a `HostTagFactory<S, HSelf>`; every
  instance it makes (`Family<Self>(id)`) is a host-bearing tag. Hostless `tagFor` stays a
  `TagFactory<S>` (unchanged). Overloads discriminate on `options.host` presence (cast-free,
  like `makeTag`); `HSelf` is inferred once from the factory call and applied to all instances.
- `QueueResource.Tag<Self>()(id, itemSchema, { host: EdgeHost })` → the queue tag carries its
  own transport; delegates to `Resource.Tag<Self>(id)(spec, host)`.
- The host rides each function's **inferring call** with an `options` slot (the spec/factory
  call for `tagFor`, the `(id, schema, options)` call for `QueueResource.Tag`) — so `host` sits
  in `options` there rather than as a bare positional (the inferring call already owns an
  options arg; this keeps existing positional callers unbroken and avoids a runtime guard).
- Type proofs: hosted family + hosted queue clients require their host; hostless ones keep the
  ambient Protocol (`test/resource.test-d.ts`, `test/queue-contract.test.ts`).

New public types: `HostKey`, `TagFactory`, `HostTagFactory` (exported from the barrel).

## Status — SHIPPED (slice 3: rename + symmetric http helpers)

- **Renamed** `Resource.host` → **`Resource.connect`** (the transport-agnostic primitive;
  takes a host + any RPC client `Protocol` layer). The old case-only `Host`/`host` collision
  is gone.
- **`Resource.connectHttp(host, { url, serialization? })`** — batteries-included client: builds
  the http `Protocol` (Fetch + serialization) and re-keys it under the host. One line.
- **`Resource.serveHttp(tag, impl, { path?, serialization? })`** — the server mirror: mounts
  the contract group on an http `RpcServer` (path default `/rpc`) with handlers + serialization;
  the only thing left to provide is a platform `HttpServer` (e.g. `NodeHttpServer.layer({ port })`),
  since bind address is a deployment concern. Collapses the 6-line server incantation to one.
- **Serialization SSOT-by-default:** both helpers default to `RpcSerialization.layerNdjson`
  (handles one-shot **and** streaming), so a client and server can't silently disagree on the
  codec. Address stays per-side (dial-url vs bind-port are different deployment concerns).
- Naming avoids near-collisions: `server`/`serveHttp` (low-level/http) and
  `connect`/`connectHttp` mirror each other.
- `test/resource-host-http.test.ts` now dogfoods `serveHttp` + `connectHttp`.

## Host implementation — original design notes (kept for reference)

**Cast-free transport re-keying — confirmed.**
```ts
type HostProtocol = Context.Service.Shape<typeof RpcClient.Protocol>;
const makeHost = <Self>(name: string) => Context.Service<Self, HostProtocol>()(name); // Resource.Host
const hostLayer = (host, protocol /* Layer<RpcClient.Protocol> */) =>
  Layer.effect(host, RpcClient.Protocol).pipe(Layer.provide(protocol));             // Resource.host
// Resource.client(tag): Effect.provideService(RpcClient.make(group), RpcClient.Protocol, yield* tag.host)
```
All of this typechecks with **no casts**.

**The open wrinkle — host-on-tag gating typing.** `Resource.client` must accept only
host-bearing tags (hostless → local-only, compile error). That needs `tag.host` to be
precisely `HostKey<HSelf>` when a host is set and absent/`undefined` when not. A conditional
field (`host: [HSelf] extends [never] ? undefined : HostKey<HSelf>`) gates `client`
correctly **but** breaks assignability elsewhere: a host-bearing tag is then *not* assignable
where `ResourceTag<Self, S>` (HSelf=never → `host: undefined`) is expected (e.g.
`Resource.instance`). Options for the next pass:
- **(a, recommended)** overload `makeTag`'s spec call — `(spec)` → `ResourceTag<Self,S>`;
  `(spec, host)` → `ResourceTag<Self,S> & { host: HostKey<HSelf> }` — with one contained
  construction cast in the impl (consistent with the existing runtime-safe boundary casts).
- (b) a distinct `RemoteResourceTag` type for host-bearing tags.
- (c) keep `host` covariant/optional and gate via a separate marker.

Then thread the optional host through `makeTag` / `tagFor` / `QueueResource.Tag` (host as the
arg in the inferring call so its `Self` is captured — Self-explicit + host-inferred can't
share one type-arg list), and the real-http test becomes: ship the tag + `Resource.host(Host,
httpProtocol)`, no manual `provideService`.

## Then

Health (`ping`/`health`/`inventory`/`contractHash`, see `resource-host-health.md`) lands as
a reserved-prefix resource once Host exists.
