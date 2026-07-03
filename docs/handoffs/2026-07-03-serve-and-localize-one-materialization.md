# Gap: no single-materialization "serve **and** use locally" — a resource that's both served and consumed in-process materializes twice

**Consumer:** wow-sports services-hub. Each league runs as one process that **serves** its resources over RPC
(dashboard + `/health` + the multi-host fold) **and** runs the ingest/queue engines **in that same process**.
We want the ingest to depend on the `Database` service — `yield* Database` → `yield* db.prisma` (the off-wire
`local` capability) — instead of importing a global prisma singleton. Found on **beta.24**.

## The scenario

A single runtime needs a resource to be **both**:

1. **served** — its wire fields exposed over RPC for remote clients (the dashboard reads `connections` /
   `status`, and peers read each other for the `fleet` fold); and
2. **local** — its `LocalCapability<Self>` granted in-process so co-located code can `yield*` a
   `Resource.local(...)` member (here: `prisma`, a non-serializable `PrismaClient`).

This is the natural shape of a co-located fleet: the box both _offers_ the service to others and _uses_ it
itself.

## What happens today

`serve` / `serveAllHttp` and `localLayer` are disjoint, so you provide **both**, and each runs the impl:

```ts
const databaseImpl = Resource.make(
  Database,
  Effect.gen(function* () {
    const conns = yield* SubscriptionRef.make(0);
    const status = yield* SubscriptionRef.make<DbStatus>({
      connected: false,
      latencyMs: 0,
    });
    const peers = yield* Resource.peers(Database);
    yield* Effect.forkScoped(
      Effect.forever(pollMetrics.pipe(/* → conns */ Effect.delay("1 second"))),
    );
    yield* Effect.forkScoped(
      Effect.forever(ping.pipe(/* → status */ Effect.delay("2 seconds"))),
    );
    return {
      prisma,
      connections: SubscriptionRef.changes(conns),
      totalConnections: fold(peers),
      status: SubscriptionRef.changes(status),
    };
  }),
);

// runtime:
serveAllHttp([Resource.serverEntry(Database, databaseImpl) /* … */]) // ← materialization #1 (for the wire)
  .pipe(Layer.provide(Resource.peersLayer(Database, self, { hosts, url })));
// …and, to let the in-process ingest `yield* db.prisma`:
Resource.layer(Database, databaseImpl) // ← materialization #2 (for Self + LocalCapability)
  .pipe(Layer.provide(Resource.peersLayer(Database, self, { hosts, url }))); // ← needs its OWN peersLayer too
```

Because `Resource.make` only anchors the impl **definition** (identity + typing), providing it twice runs the
generator twice. Per runtime that means **two `SubscriptionRef`s, two `$metrics` pollers, two ping loops**, and
**the local copy needs its own `peersLayer`** (the impl body does `yield* Resource.peers(Database)` at
materialization, so it fails to build without one — even though nothing in-process ever reads the local
`totalConnections`). The two copies drift independently; the served `connections` the dashboard sees is a
different cell than the local one.

## Root cause (signatures, `src/Resource.ts`)

- **`serve`** (≈1974) returns `Layer.Layer<HandlerContextOf<S>, never, ServeRequirements<Impl>>` — **only the
  RPC handler slots**. It builds `handlers` from `flattenImpl(impl)` and never surfaces `Self` or
  `LocalCapability<Self>` into context. So a served resource is **not** obtainable in-process.
- **`localLayer`** (= `Resource.layer`, ≈1753) returns `Layer.Layer<Self | LocalCapability<Self>>` — grants the
  in-process service + capability, but serves nothing.
- A `local` member surfaces as `Effect<T, never, LocalCapability<Self>>` (≈869) — only satisfiable via
  `localLayer`, never via a client (by design). So "serve it AND yield its local member here" strictly requires
  both layers.
- The canonical pattern in `test/resource-make.test.ts` and `test/services-hub-topology.test.ts` is a resource
  that is **local _or_ served** (per host), never both from one materialization — which is exactly the case
  that isn't covered.

`Resource.make`'s doc even names this: _"share it across the local layer and a served entry"_ — but "share the
impl" ≠ "share the materialization"; today it's two live instances.

## Impact

- Any co-located "serve + use-locally" resource pays 2× its background cost per runtime (for us: 4 pollers
  instead of 2) and must wire `peersLayer` twice.
- Stateful resources (`value` cells) exist as two independent instances; the served view and the local view can
  disagree. For a stateless capability like `prisma` it's "only" waste, but for anything with observable state
  it's a correctness footgun.
- It's enough friction that we paused Phase 2 (routing the ingest through `Database`) — the alternative of
  keeping the global import is tempting purely to avoid the double materialization, which undercuts the whole
  point of the `local` capability.

## Minimal repro

```ts
class Svc extends Resource.Tag<Svc>()("repro/Svc", {
  handle: Resource.local<{ id: number }>(),
  ticks: Resource.value(Schema.Number),
}) {}

const impl = Resource.make(
  Svc,
  Effect.gen(function* () {
    const r = yield* SubscriptionRef.make(0);
    yield* Effect.forkScoped(
      Effect.forever(
        SubscriptionRef.update(r, (n) => n + 1).pipe(Effect.delay("1 second")),
      ),
    );
    yield* Effect.log("materialized"); // ← logs TWICE when both layers below are provided
    return { handle: { id: 1 }, ticks: SubscriptionRef.changes(r) };
  }),
);

const runtime = Layer.mergeAll(
  Resource.serveAllHttp([Resource.serverEntry(Svc, impl)]), // serve the wire field
  Resource.layer(Svc, impl), // grant Self + LocalCapability in-process
);
// "materialized" prints twice; two independent `ticks` counters; both layers demand their own deps.
```

## Proposed fix

A **serve-that-also-localizes** provisioning — materialize the impl **once**, then both (a) put `Self |
LocalCapability<Self>` in context and (b) register the wire handlers **derived from that same materialized
service** (read the `value` fields' `SubscriptionRef`s, the `effect`/`stream` members, etc. — the inverse of the
client materialization, which already reconstructs a service from wire members). Shapes that would fit:

- `Resource.serveLocal(tag, impl)` / a `local: true` option on `serverEntry` / `serveAllHttp`, or
- a `Resource.hostEntry` used inside `serveAllHttp` that yields both the handler registration and the local
  grant from one build.

Result: `Layer.Layer<HandlerContextOf<S> | Self | LocalCapability<Self>, never, R>` from **one** run of the
impl — one poller pair, one `peersLayer`, one set of `value` cells that the dashboard and the in-process
consumer both observe. This mirrors the host-free-multiHost fix (move a deployment concern to the use site
without duplicating the resource) and is reusable for every co-located serve-and-use resource.

## Alternatives we can use meanwhile (no lib change)

- **Accept the double materialization** — make the pollers cheap/idempotent and wire `peersLayer` to the local
  layer too. Works; wasteful; `value`-state drift remains (fine for `prisma`, not for stateful resources).
- **Split impls** — a minimal _local_ impl (`prisma` + trivial/constant cells, no pollers, no peers) for
  `Resource.layer`, plus the full impl for `serverEntry`. Avoids the extra pollers and the local `peersLayer`,
  but it's two impls for one resource and the local cells are fake (acceptable only because nothing in-process
  reads them).

We'll pilot the split-impls route to keep Phase 2 moving unless you'd rather land the combined layer first —
flagging so the design is yours, since the "serve the materialized Self" path touches the serve internals.
