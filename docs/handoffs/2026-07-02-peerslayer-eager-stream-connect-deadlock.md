# Bug: `peersLayer` eager-connects stream-bearing peer clients at build → same-box fleet deadlock

**Consumer:** wow-sports services-hub, building a `FleetDatabase` resource — one tag `multiHost`'d across
three **co-located** runtimes (separate PM2 processes on one droplet, loopback ports 3001/3002/3003), with a
`fleet` `totalConnections` field folding each peer's `runtimeConnections`. **Found on beta.22.**

## Symptom

With `peersLayer(FleetDatabase, self, { url })` providing peer URLs, **the serve hangs on boot** — it never
reaches `Listening`. It hangs during layer construction, _after_ the app's own boot gate. Three runtimes
booting together **deadlock** (each blocks waiting for the others). Even a **single** serve booted alone
hangs, because its `peersLayer` tries to reach the (down) peers.

Without peer URLs (peers skipped, empty mesh) it boots fine.

## Root cause (isolated)

The hang is **stream-specific** — it happens only when the multiHost resource has a **`value` or `stream`**
field. Confirmed empirically:

| leaf field                                           | boots alone w/ peer URLs?    |
| ---------------------------------------------------- | ---------------------------- |
| `runtimeConnections: Resource.value(Schema.Number)`  | ❌ hangs                     |
| `runtimeConnections: Resource.effect(Schema.Number)` | ✅ boots (peer clients lazy) |

Trace (`src/Resource.ts`):

- **`peersLayer`** builds all peer clients **at layer-build**, in a `Layer.effect`:
  ```ts
  const entries = yield* Effect.forEach(
    resolved.filter(has url),
    ({ key, url }) => Effect.map(buildPeerClient(tag, url), (client) => [key, client]),
  );
  ```
- **`buildPeerClient`** (≈ line 2598) builds the HTTP RPC transport + client eagerly:
  ```ts
  const context = yield* Layer.build(
    RpcClient.layerProtocolHttp({ url }).pipe(Layer.provide(defaultSerialization), Layer.provide(FetchHttpClient.layer)),
  );
  const client = yield* Effect.provideService(RpcClient.make(tag[groupSym] …), RpcClient.Protocol, …);
  ```
- For a resource with a **`value`/`stream`** field, the client needs a **persistent connection** to receive
  the pushed delta/stream channel, so `RpcClient.make` (or the protocol build) **opens the connection
  eagerly** and **blocks** when the peer isn't listening. An `effect`-only resource is request-lazy
  (POST-per-call), so `RpcClient.make` returns without connecting → boot proceeds.

## Why this matters

This breaks the **"applicable now"** multi-host case: co-located runtimes (the FleetDatabase / fleet-metrics
board pattern — multiple serves on one box) **boot together**, so no peer is reachable during the boot
window. Any `value`/`stream` field on a multiHost resource then makes the fleet unbootable. It also
contradicts the documented promise — `peersLayer` treats a **missing-URL** peer as _"a partial mesh, not a
failure"_, but a **URL'd-but-unreachable** peer **blocks** instead of deferring.

## Minimal repro

```ts
class Live extends Resource.Tag<Live>()("repro/Live", {
  n: Resource.value(Schema.Number),                 // value (or stream) — the trigger
}).pipe(Resource.multiHost([HostA, HostB])) {}

// serve on HostA with peers pointing at HostB (which is down / not up yet):
Resource.serveAllHttp([Resource.serverEntry(Live, Effect.map(SubscriptionRef.make(0), (r) => ({ n: SubscriptionRef.changes(r) })))])
  .pipe(Layer.provide(Resource.peersLayer(Live, HostA, { url: () => Effect.succeed("http://127.0.0.1:9999/rpc") })), …)
// → layer build hangs on buildPeerClient(HostB) opening the stream transport to a dead endpoint.
// Swap `n` to Resource.effect(Schema.Number) → boots (client is request-lazy).
```

## Fix directions (your call — RPC lifecycle is yours)

1. **Lazy peer clients** — don't build/connect peer clients at `peersLayer` build; defer the transport (at
   least the persistent stream connection) to first use. `combineQuery` already drops a failing peer
   per-query, so a down peer during a fold is naturally partial; boot shouldn't depend on peers being up.
2. **Split request vs stream transport** — build the request (POST) transport eagerly (it's lazy anyway) but
   defer the persistent stream connection until a `value`/`stream` field is actually subscribed.
3. **Build with timeout + heal** — connect with a timeout; on failure, keep the peer as a reconnecting
   client rather than blocking or permanently dropping it (must not silently lose the peer).
4. **At minimum** — document that a `value`/`stream` field on a multiHost resource requires peers reachable
   at build, i.e. rules out same-box simultaneous boot — and reconcile that with the "partial mesh, not a
   failure" wording.

## Consumer status (not blocked)

We shipped FleetDatabase with `runtimeConnections` as **`effect`** (pull) — boots + peers + the fold verifies
end-to-end (`wnba.totalConnections == Σ runtimeConnections`, 3 == 1+1+1 across the three runtimes). We'd
switch the leaf to **`value`** (a live count, nicer for the dashboard's `Resource.changes` subscribe) the
moment peer stream-clients connect lazily. Flagging so the next consumer doesn't have to bisect it.

---

## RESOLVED (2026-07-02, branch queue-value-adoption)

**Fix: peer clients are now fully lazy** (`buildPeerService`, replacing `buildClientService` inside
`buildPeerClient`). A peer never resolves `constant`s or subscribes `value`/`stream` fields at build — so
nothing connects until a fold reads a field:
- `value` on a peer reads **one-shot** (`Stream.runHead` → its replayed current) — an `Effect`, so
  `combineQuery(peers, (p) => p.n, …)` works exactly like an `effect` field. `PeerServiceOf<value>` is now
  `Effect<A>` (was `Stream<A>` via the generic leaf mapping).
- `effect`/`effectFn`/`stream`/`constant` are already their lazy wire forms.

Result: a `value`-bearing multiHost resource **boots against a down/co-booting peer** (verified: build
completes in ~4ms vs the 30s block-for-initial deadlock), and a fold **drops** an unreachable peer — a
refused peer fails fast; a black-hole peer should be per-peer `Effect.timeout`'d by the consumer's fold
(the library doesn't impose a connect timeout). So you can switch `runtimeConnections` to `value` now.

Regression test: `test/multi-host-peers-lazy.test.ts` (build-boots + fold-drops-down-peer).
