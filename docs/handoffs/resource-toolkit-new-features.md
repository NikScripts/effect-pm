# Resource toolkit — new features guide

A self-contained reference to the capabilities added to the **Resource toolkit** on the
`rewrite/resource-toolkit` branch: **hosts (ship-only-the-tag)**, **streaming `.changes`**, and
the **batteries-included http helpers**. Written for agents working on other parts of the
package. Everything here is shipped, typechecked, LSP-clean, and covered by tests.

Import surface: `import { Resource } from "@nikscripts/effect-pm"` (the toolkit `Resource`
object is in the root barrel). Public types (`HostKey`, `TagFactory`, `HostTagFactory`,
`Method`, `ServiceOf`, `Spec`, `ResourceTag`, …) are exported from the barrel too. The queue
contract (`queueControlSpec`, `queueSnapshot`, `QueueResource` toolkit form) currently lives in
`src/QueueContract.ts` and is **not** in the barrel yet (the legacy `QueueResource` still owns
that export name) — import it from the module path if you need it.

Runs on `effect@4.0.0-beta.69`. Verify APIs against the resolved package, not memory.

---

## 0. Mental model (unchanged, but the foundation)

A resource is a schema-defined service **tag**. The same `yield* Tag` code runs **locally** or
**remotely** — only the provided layer changes (location transparency):

```ts
const c = yield* Counter;     // identical whether Counter is local or across the network
yield* c.increment({ by: 1 });
```

- `Resource.layer(tag, impl)` — run it locally with a real implementation.
- `Resource.client(tag)` — drive it remotely over RPC, as if local.
- `Resource.server(tag, impl)` — expose a local impl over RPC (transport-agnostic handlers).
- `Resource.serveInstances(factory, …)` — serve many factory instances behind one group.

A spec is the single source of truth; the service interface, the RPC group, the client
forwarder, and the server handlers all derive from it.

---

## 1. Method kinds: `query`, `mutate`, `stream`

A spec maps method names to method definitions. Three constructors:

```ts
class Jobs extends Resource.Tag<Jobs>("jobs")({
  size:    Resource.query(Schema.Number),                                   // one-shot read  → Effect
  enqueue: Resource.mutate(Schema.Void, { payload: { task: Schema.String } }), // mutation    → Effect
  changes: Resource.stream(QueueSnapshot),                                  // live source    → Stream
}) {}

const j = yield* Jobs;
const n   = yield* j.size;              // Effect<number>
yield*      j.enqueue({ task: "x" });   // Effect<void>
yield* Stream.runForEach(j.changes, render); // Stream<QueueSnapshot>
```

- **`query(success, opts?)`** — idempotent read. Service member is `Effect<Success, Error>`
  (a property), or `(payload) => Effect<…>` when `opts.payload` is given.
- **`mutate(success, opts?)`** — mutation. Same shapes; tools treat it as a command.
- **`stream(success, opts?)`** — a live push source. Service member is `Stream<Success, Error>`
  (or `(payload) => Stream<…>`). Counts as a `query` for tooling. **See §2.**

`opts` is `{ payload?: Schema.Struct.Fields; error?: Schema.Top }`. No payload → property; with
payload → function. The `error` schema (if any) becomes the method's typed failure channel.

**Metadata** rides `.annotate({ description, destructive })` (Effect's annotation idiom):

```ts
shutdown: Resource.mutate(Schema.Void).annotate({
  description: "Permanently stop the queue.",
  destructive: true,   // CLI confirms / dashboard shows danger styling
}),
```

Read it back with `methodMeta(method)` → `{ kind, description, destructive, streaming }`.
`streaming: true` lets tools render a "watch" affordance.

> ⚠️ **Do not** write `satisfies Spec` on a spec object — it contextually widens each method's
> error channel to `unknown`. The spec is validated (without widening) at the `Resource.Tag`
> call site. (This is why `queueControlSpec` has no `satisfies`.)

---

## 2. Streaming `.changes` — live status

`Resource.stream(success, opts?)` declares a streaming method. Its service member is a
`Stream`, not an `Effect`. On the wire it becomes an `RpcSchema.Stream` (the immediate RPC
succeeds with `void`; elements and stream-errors ride the chunk stream). `success` is the
**element** schema; `error` (if any) is the **stream-error** schema.

### Server impl pattern (the live-status primitive)

Back `changes` with a `SubscriptionRef`. A subscriber receives the **current value first**,
then **every subsequent change** — exactly the "watch status" source for a dashboard atom, a
CLI `--watch`, or a TUI.

```ts
import { Effect, Stream, SubscriptionRef } from "effect";

const program = Effect.gen(function* () {
  const ref = yield* SubscriptionRef.make(initialSnapshot);

  const Live = Resource.layer(Status, {
    set:     ({ value }) => SubscriptionRef.set(ref, value),  // a mutation updates state…
    changes: SubscriptionRef.changes(ref),                    // …subscribers see it
  });
  // …provide Live and use `yield* Status` anywhere.
});
```

Note `SubscriptionRef.changes(ref)` is a **function** (not `ref.changes`) in this Effect
version.

### Consuming

```ts
const s = yield* Status;
yield* Stream.runForEach(s.changes, (snap) => Effect.log(snap)); // run it
// or take a finite prefix:
const first3 = yield* Stream.runCollect(Stream.take(s.changes, 3));
```

### Hard requirement: ndjson serialization

Streaming over http needs a **newline-delimited** codec for chunked responses. Use
`RpcSerialization.layerNdjson` on **both** client and server — **not** `layerJson` (a single
JSON body can't stream). The http helpers (`serveHttp`/`connectHttp`, §4) **default to ndjson**,
so if you use them you get this for free and the two sides can't disagree.

### Gotcha: the in-memory `RpcTest` path

`RpcTest.makeClient` currently throws `Cannot read properties of undefined (reading '_tag')`
when you **call** a streaming method in-memory. Having a streaming method *in the group* is
fine (RpcTest control tests still pass) — but to **exercise** a stream, test over a **real
http transport** (see `test/resource-stream-http.test.ts`). This is an Effect RpcTest issue,
not a toolkit bug.

### Queue example

`queueControlSpec` (in `src/QueueContract.ts`) now includes a live snapshot:

```ts
export const queueSnapshot = Schema.Struct({
  sizes: queueSizes,        // { high, normal, low }
  paused: Schema.Boolean,
  completed: Schema.Number,
});
// queueControlSpec.changes = Resource.stream(queueSnapshot)
```

---

## 3. Hosts — ship only the tag

A **host** is where a resource lives. Put it on the tag and you ship **only the tag**:
`Resource.client(tag)` resolves *where to connect* from the tag's host, and a consumer wires
the transport once. No per-resource client layer to package.

### Declare a host

```ts
class EdgeHost extends Resource.Host<EdgeHost>("edge") {}
```

`Resource.Host<Self>(name)` is a `Context.Service` whose value is the RPC client transport.
Extend it like any Effect service.

### Attach a host to a tag

The host rides each constructor's **inferring call** (the call that has no explicit `<Self>`),
because a `<Self>`-explicit call can't also infer the host's identity:

```ts
// single resource — host is the 2nd arg of the spec (inferring) call
class Jobs extends Resource.Tag<Jobs>("jobs")(spec, EdgeHost) {}

// factory — host in options (one host baked into every instance)
const Procs = Resource.tagFor("proc", procSpec, { host: EdgeHost });
class P1 extends Procs<P1>("@app/p1") {}   // host-bearing

// queue — host in options
class Q extends QueueResource.Tag<Q>()("@app/Q", ItemSchema, { host: EdgeHost }) {}
```

A tag **without** a host is fine — it just runs locally (`Resource.layer`) or is served as its
own process and reached with an ambient-Protocol client (§5). Remote use is optional.

### Wire the transport (client side)

```ts
// batteries-included http (recommended) — defaults to ndjson
const EdgeLive = Resource.connectHttp(EdgeHost, { url: "http://10.0.0.2:3002/rpc" });

// transport-agnostic primitive — bring any RPC client Protocol layer
const EdgeLive = Resource.connect(EdgeHost, someProtocolLayer);
```

`connectHttp(host, { url, serialization? })` builds the http `Protocol` (Fetch + serialization)
and re-keys it under the host. `connect(host, protocolLayer)` is the low-level form for
websocket/socket/custom transports.

### `Resource.client(tag)` is overloaded (non-breaking)

```ts
// host-bearing tag → the layer requires the HOST (ship only the tag)
const layer: Layer<Jobs, never, EdgeHost> = Resource.client(Jobs);
program.pipe(Effect.provide(layer), Effect.provide(EdgeLive));

// hostless tag → the layer requires the ambient RpcClient.Protocol (as before)
const layer: Layer<Echo, never, RpcClient.Protocol> = Resource.client(Echo);
program.pipe(Effect.provide(layer), Effect.provide(httpProtocolLayer));
```

Multi-host works: each `connectHttp`/`connect` re-keys its own host; provide one per host the
app talks to.

---

## 4. http serving — `serveHttp` (the server mirror)

`Resource.serveHttp(tag, impl, opts?)` collapses the old six-line server incantation into one
call. It mounts the contract group on an http `RpcServer` with the impl's handlers and the
serialization codec. The **only** thing left to provide is a platform `HttpServer` (bind
address is a deployment concern, and the platform layer can't live in the toolkit):

```ts
import { NodeHttpServer } from "@effect/platform-node";

const JobsServer = Resource.serveHttp(Jobs, jobsImpl).pipe(
  Layer.provideMerge(NodeHttpServer.layer({ port: 3001 })),
);
```

`opts` is `{ path?: HttpRouter.PathInput; serialization?: Layer<RpcSerialization> }` — `path`
defaults to `/rpc`, serialization defaults to **ndjson**. The server never needs a host (the
host is the *client's* connection target). For tests, `NodeHttpServer.layerTest` binds an
ephemeral port and also provides a matching `HttpClient`.

Pairing: **`server`/`serveHttp`** (low-level handlers / batteries-included http) mirrors
**`connect`/`connectHttp`** (low-level transport / batteries-included http).

### Serialization is SSOT-by-default

Both `serveHttp` and `connectHttp` default to `RpcSerialization.layerNdjson`. A client and
server therefore agree on the codec by construction (and ndjson supports streaming). If you
override it, override it on **both** sides. Mismatched serialization is a silent decode
failure.

---

## 5. Putting it together — peers controlling each other

Two processes, each **serving** its own resource and holding a **client** to the other. The
business logic is identical to the in-process version:

```ts
// shared.ts — contracts both processes import
class QueueHost extends Resource.Host<QueueHost>("queue-host") {}
class SchedHost extends Resource.Host<SchedHost>("sched-host") {}
class Jobs      extends Resource.Tag<Jobs>("jobs")(jobsSpec, QueueHost) {}
class Scheduler extends Resource.Tag<Scheduler>("scheduler")(schedSpec, SchedHost) {}

// transport.ts — addresses (per-side; env-portable via Config)
export const QueueAt = Resource.connectHttp(QueueHost, { url: "http://10.0.0.1:3001/rpc" });
export const SchedAt = Resource.connectHttp(SchedHost, { url: "http://10.0.0.2:3002/rpc" });

// process-a.ts — runs Jobs, controls Scheduler
worker.pipe(
  Effect.provide(Resource.client(Scheduler)),                 // Scheduler = remote
  Effect.provide(SchedAt),                                    // …reachable at B
  Effect.provide(Resource.serveHttp(Jobs, jobsImpl).pipe(     // …and host Jobs for others
    Layer.provideMerge(NodeHttpServer.layer({ port: 3001 })),
  )),
);

// process-b.ts — runs Scheduler, controls Jobs (the mirror)
control.pipe(
  Effect.provide(Resource.client(Jobs)),
  Effect.provide(QueueAt),
  Effect.provide(Resource.serveHttp(Scheduler, schedImpl).pipe(
    Layer.provideMerge(NodeHttpServer.layer({ port: 3002 })),
  )),
);
```

To run both in one process for a test: provide `Resource.layer(Jobs, jobsImpl)` and
`Resource.layer(Scheduler, schedImpl)` instead — the logic doesn't change.

Scale: for **N instances of one shape** (e.g. 100 processes that only `start`/`drop`), use one
`tagFor` factory with `Resource.serveInstances(...)` server-side and `Resource.clientInstances(...)`
client-side — one group, one connection, routed by the per-call `id` header.

---

## 6. Quick API reference (`Resource.*`)

| Member | Purpose |
|---|---|
| `Tag<Self>(id, opts?)(spec, host?)` | Define one resource. `host` (2nd spec-call arg) → host-bearing tag. |
| `tagFor(groupId, spec, opts?)` | Factory for many instances of one contract. `opts.host` binds the family. |
| `Host<Self>(name)` | Declare a host (transport endpoint identity). |
| `connect(host, protocolLayer)` | Wire a host's transport from any RPC `Protocol` layer. |
| `connectHttp(host, { url, serialization? })` | Wire a host over http (defaults ndjson). |
| `query(success, opts?)` | One-shot read → `Effect`. |
| `mutate(success, opts?)` | Mutation → `Effect`. |
| `stream(success, opts?)` | Live source → `Stream`. |
| `local<T>()` | Local-only member (gated by `LocalCapability`; compile error via a client). |
| `layer(tag, impl)` | Run locally with a real impl. |
| `server(tag, impl)` | Transport-agnostic RPC handlers layer. |
| `serveHttp(tag, impl, opts?)` | Expose over http in one call (needs an `HttpServer`). |
| `serveInstances(factory, …instances)` | Serve many factory instances behind one group (by `id`). |
| `client(tag)` | Remote client. Host-bearing → requires the host; hostless → requires `RpcClient.Protocol`. |
| `clientInstances(factory, …tags)` | One client for many instances of one shape. |
| `instance(tag, impl)` | Pair an instance tag with its impl for `serveInstances`. |

New public **types**: `HostKey<HSelf>`, `TagFactory<S>`, `HostTagFactory<S, HSelf>`,
`Method<Kind, P, Su, E, Str>` (now has a 5th `Str` stream param), `MethodMeta` (now has
`streaming`).

---

## 7. Rules & gotchas (for anyone touching the toolkit)

- **Streaming needs ndjson.** `layerJson` can't stream. The http helpers default to ndjson;
  if you wire transport by hand, use `RpcSerialization.layerNdjson` on both sides.
- **`RpcTest` can't *call* streams** (`_tag of undefined`). Test streams over real http.
- **No `satisfies Spec`** on spec objects (widens the error channel to `unknown`).
- **Host goes in the inferring call** — `Tag(...)(spec, host)`, `tagFor(g, spec, { host })`,
  `QueueResource.Tag<Self>()(id, schema, { host })`. Not alongside an explicit `<Self>`.
- **Ids and group-ids are unique** — duplicates throw at declaration (`DuplicateResourceId` /
  `DuplicateGroupId`). Effect's `Context` is keyed by the id string and would silently
  last-write-wins otherwise.
- **Serialization must match** client/server (default ndjson makes it match; override both).
- **The server never needs a host.** The host is the client's "where to connect."
- **Typed errors only.** Use `Data.TaggedError`, never raw `Error`; runtime faults inside the
  toolkit use `Effect.die(taggedError)`.
- **Self-verify with the Effect LSP CLI** on every file you touch — tsgo/tsc do **not** emit
  the Effect lint rules:
  `npx effect-language-service diagnostics --file "$(pwd)/path.ts" --format text`.
- Verify: `pnpm typecheck` (both tsconfigs), `pnpm lint`, `pnpm test`, `pnpm build`.

---

## 8. Where the design is recorded

- `docs/handoffs/resource-host.md` — host-in-tag design + the connect/serveHttp rename, all
  slices marked SHIPPED.
- `docs/handoffs/resource-changes-stream.md` — the streaming design (Plan A) marked SHIPPED.
- Tests as executable spec: `test/resource.test.ts`, `test/resource.test-d.ts` (type proofs),
  `test/resource-host-http.test.ts`, `test/resource-stream-http.test.ts`,
  `test/queue-contract.test.ts`.
