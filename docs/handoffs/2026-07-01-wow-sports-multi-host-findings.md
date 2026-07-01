# Multi-host peers — consumer findings from the wow-sports fleet-DB prototype

> Grounded in a real prototype, not theory. wow-sports built a hostless multi-host `FleetDatabase`
> against beta.16 (`Resource.multiHost` + `peers` + `MultiHost.combineQuery`) — one resource served on
> `NwslHost`/`EbwslHost`/`WnbaHost`, a `status` leaf (each process's Postgres ping) + a `fleetStatus`
> `fleet` field folding a droplet-wide health view. This captures what worked, what's open, and what I
> hit that the SSOT (`multi-host-instances-decisions.md`) doesn't obviously cover. Prioritized by
> consumer-adoption value, not by effort.

## What was proven (server side is solid)

- The **tag** (`Resource.multiHost([NwslHost, EbwslHost, WnbaHost])`), the **`fleet` field**, and the
  **fold** (`combineQuery` + `Combine.byHost`/`failures`) all work as documented.
- **Down-host handling is correct**: a peer whose `status` query fails is a captured failed exit
  (`reachable: false`), never a thrown gather. Unit-tested via `peersFrom` with a defect peer.
- **Serve integration works**: `serveAllHttp([serverEntry(FleetDatabase, impl)])` +
  `peersLayer(FleetDatabase, NwslHost)` typechecks, boots, and `/health` stays 200.

So the primitives are sound. The gaps below are about the **consumption ergonomics**, not the core.

## Open / needed, ranked by what unblocks a real fleet-health _table_

### 1. A "which host am I?" accessor for the impl — needed for `byHost` folds

> **✅ Resolved (beta.17):** `Resource.selfHost(tag)` — returns the host key this instance runs as (the
> same key `peers` are keyed by). Provided by `peersLayer` (now bundled) or standalone `selfHostLayer`.
> No hand-threading: `return { ...byHost, [yield* Resource.selfHost(tag)]: ownValue }`. See
> `test/multi-host-selfhost.test.ts`; dogfooded on `WorkerPool.activeByHost` in `resource-web`.

`peersLayer(tag, self)` knows `self`; the `serverEntry` impl does **not** receive it. That's fine for
`Combine.sum` (self is a value you add in), but a fleet **health table** wants `Combine.byHost` — one
row per host, keyed — and the impl then has to key _its own_ row with no way to name itself. We worked
around it by threading the key by hand:

```ts
// prototype workaround — the impl can't name its own host, so we pass it in
export const fleetDatabaseImpl = (selfHostKey: string, selfStatus: Effect<DbStatus>) =>
  Effect.gen(function* () {
    const peers = yield* Resource.peers(FleetDatabase);
    return {
      status: selfStatus,
      fleetStatus: Effect.gen(function* () {
        const fold = yield* combineQuery(peers, (p) => p.status, (r) => ({
          up: Combine.byHost(r), down: Combine.failures(r).map((f) => f.host),
        }));
        return { hosts: [{ host: selfHostKey /* ← threaded */, reachable: true, status: yield* selfStatus }, ...] };
      }),
    };
  });
```

Decision #9 ("add self yourself") covers the self _value_; it doesn't cover the self _identity_.
**Ask:** a `Resource.selfHost` accessor (or pass `self` into the `layer`/`serverEntry` Effect form) so
`byHost`-style folds don't need the consumer to hand-thread the key. If such an accessor already exists,
it isn't discoverable from the tests/examples (all of which use `Combine.sum`, which sidesteps it).

### 2. Config/runtime peer URLs for `peersLayer`

`peersLayer` reads each `Host.url`, which is baked into the (browser-safe) host contract. To wire the
mesh we hardcoded loopback control ports into the host defs:

```ts
export class NwslHost extends Resource.Host<NwslHost>("…/NwslHost", {
  url: "http://127.0.0.1:3002/rpc",
}) {} // ← hardcoded; port is really a deploy concern
```

`connectHttp` lets an explicit arg override `host.url`; `peersLayer` has no equivalent, so
env-specific deploys (staging vs prod ports, or Cloudflare-tunneled peers) have to fall back to
building clients by hand + `peersFrom`. **Ask:** a `peersLayer` variant taking a URL resolver / override
map (or reading peer URLs from a `ConfigProvider`), so mesh wiring isn't frozen into the contract. This
is the blocker for a fleet that isn't all on one droplet.

### 3. Client read for a _hostless_ multiHost tag (already flagged as "coming next")

> **✅ Resolved (beta.17):** `Resource.client(tag, host)` — name which instance to read;
> `Resource.client(FleetDatabase, NwslHost).pipe(Layer.provide(connectHttp(NwslHost)))`. The transport
> resolves from the host, so the requirement is enforced at compile time (no more runtime "Service not
> found"). See `test/multi-host-hostless-client.test.ts`.

This is the SSOT's own open question (`multi-host-instances.md` line 60: _"with no host on the tag, how
does `Resource.client` name the host?"_). Confirmed from the consumer side: `connectHttp(NwslHost)` +
`Resource.client(FleetDatabase)` fails at runtime with **`Service not found:
effect/rpc/RpcClient/Protocol`** — the hostless client can't bind the transport's protocol. The
`resource-web/hub.ts` example wires clients only for host-bound tags; the hostless-tag client path isn't
demonstrated anywhere, so consumers have no pattern to copy. This gates the dashboard entirely — noting
it here so the "coming next" work has a concrete repro.

## Deliberate boundary worth an explicit decision

### 4. Fleet-level readiness

> **✅ Decided (2026-07-01): keep readiness per-host + local; `/health` never hops cross-host.** A
> health check that reached peers would be slow and *cascade* (one host down → all report unhealthy).
> Fleet-aware alerting is a **separate monitor** polling a `fleet` field as a client — observation, not
> gating. Locked as decision #11 in `multi-host-instances-decisions.md`. Fleet-gated `/health` would
> need a new explicit opt-in; not added implicitly.

Decisions doc: _"readiness stays per-host and local; no cross-host hop."_ So a `fleetStatus` can't feed
`/health` or an alert ("page if <2/3 DBs live"). That's a fine default, but if fleet-aware gating is ever
wanted there's no path today. Flagging it so it's a **decision**, not a silent gap.

## Acknowledged as deferred (not blockers at our scale)

Per the decisions doc's "Deferred / open", none of these block wow (3 hosts = a 6-connection mesh):

- **Coordinator** (standalone instance-manager, not an elected peer) — out of scope for the core.
- **Same-host multiplicity** (the reserved instance-key mechanism) — our discriminator is the host.
- **Scale via push-to-redis** — only for large fleets; league scale is fine on the mesh.

## Adjacent, pre-existing

**Host-bound `withReadiness` (#29 / `withreadiness-host-bound-tags.md`)** — **✅ verified live in
beta.16** (2026-07-01): both forms accept a host-bound tag (data-last `.pipe` + data-first
`withReadiness(HostBoundClass, fn)`), no `TS2684`/`TS2345`; readiness suite green; that doc is closed.
wow can now un-park `databaseReadiness` and let the per-league DB gate `/health`.

---

**Bottom line for whoever picks up the effect-pm side:** #3 (hostless client) + #1 (self-host for
`byHost`) are the two that turn this prototype into a shippable droplet-health table; #2 (config URLs)
is the one that matters the moment leagues span machines/tunnels. Prototype lives on the wow branch
`proto/multi-host-database`.
