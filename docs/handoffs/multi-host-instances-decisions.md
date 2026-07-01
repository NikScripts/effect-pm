# Decisions: one resource, N host-local instances (multi-host)

**Status:** the core is **SHIPPED** on `cursor/multi-host-instances` (peers model). This doc is the SSOT —
build from it, don't regenerate shapes from chat. Earlier drafts explored a "multi-host contract field
kind" (`m.query`/`m.stream`/`Resource.combined`) — that was **gutted**; combined fields are plain queries
implemented via `Resource.peers`. Exploration input: `multi-host-instances.md` (wow-sports).

## The need
One resource **shape** (e.g. `Database`) served as **N instances**, one per host (`Database` on
`NwslHost` / `EbwslHost` / `WnbaHost`): same contract, independent state + readiness, each served locally.
The consumer holds **one class**, never N. It's "one resource, N instances," not "N resources."

## The shape (shipped)
```ts
// hosts carry their own url
class NwslHost extends Resource.Host<NwslHost>("nwsl", { url: nwslUrl }) {}
// … EbwslHost, WnbaHost

// contract — plain fields; combined fields are plain queries tagged `fleet`. The fleet is a
// **factory option** (`multiHost`), so the tag stays hostless — every instance is an equal peer,
// no "primary" host. (A hostless tag with a `.pipe(combinator)` in class-extends recurses, so the
// fleet rides the factory, not a pipe.)
class Database extends Resource.Tag<Database>()("app/Database", {
  connections:      Resource.query(Schema.Number),
  totalConnections: Resource.query(Schema.Number).pipe(Resource.fleet),
}, { multiHost: [NwslHost, EbwslHost, WnbaHost] }) {}

// layer — the Effect form: resolve peers once; totalConnections folds peers + self
const database = Resource.layer(
  Database,
  Effect.gen(function* () {
    const peers = yield* Resource.peers(Database);
    return {
      connections: Effect.sync(() => pool.activeCount()),
      totalConnections: combineQuery(peers, (p) => p.connections, Combine.sum).pipe(
        Effect.map((others) => pool.activeCount() + others),
      ),
    };
  }),
);

// serve a host: the layer + the peers capability (opt-in mesh) + an http server
Resource.serveAllHttp([Resource.serverEntry(Database, databaseImpl)]).pipe(
  Layer.provide(Resource.peersLayer(Database, NwslHost)),
  Layer.provideMerge(NodeHttpServer.layer({ port })),
);
// a client → any host → totalConnections → that host gathers peers + self → the fleet total.
```

## Locked decisions
1. **Groups only organize.** One tag = one group node; same-tag-at-multiple-positions = a cross-link
   (one identity, many nav paths), never the instance mechanism. Instance count is a runtime fact.
2. **The `Host` carries its url** (`Resource.Host("id", { url })`), and the fleet is a `Tag` factory
   option (`{ multiHost: [hosts] }`) — the tag stays **hostless**, no primary. (A `multiHost([hosts])`
   pipe combinator exists too, for host-bound tags — but the option is the multi-host default.) So the
   tag is self-describing (fleet + each host's url). `connectHttp` reads `host.url` (an explicit arg
   overrides); neither → `MissingHostUrl`.
3. **A server layer per host** — each host runs the same `serverEntry(Database, impl)`. Not
   "one-serves-the-rest."
4. **No instance suffix** for multi-host — the host (transport) is the discriminator. The key/suffix is
   reserved for **same-host** multiplicity (deferred).
5. **Combined fields are plain queries, tagged `Resource.fleet`.** `Resource.fleet(method)` (or
   `query(...).pipe(Resource.fleet)`) marks a field as combined-across-the-fleet: served + client-visible
   like any query, but **excluded from `peers`** (`PeerServiceOf`) so a fold can't call a peer's own fleet
   field (fan-out). The one lightweight tag the plain-query model keeps.
6. **`Resource.layer` has an `Effect` form (layer-from-effect).** Build the impl effectfully — acquire a
   pool, **resolve `peers` once** — and its requirement `R` becomes the layer's (members close over what
   they need, stay `R = never`). Provide `R` (e.g. `peersLayer`) alongside. Mirrors `serverEntry`'s two
   forms; `serverLayer`/`serveHttp`/`serveAllHttp` carry `R` via the `serverEntry` Effect form.
7. **`peers` is the opt-in mesh.** `Resource.peers(tag)` yields the other hosts' **leaf** clients (keyed
   by host), for the resource's own cross-host logic. `Resource.peersLayer(tag, self)` connects the
   `multiHost` set (minus self) via each `Host.url`; `Resource.peersFrom(tag, clients)` provides an
   explicit client map (a holder's bundles, or a test). Connections from a host to its peers exist **only**
   where you provide `peersLayer` — nowhere else meshes.
8. **Combine primitives are isomorphic** (`@nikscripts/effect-pm/MultiHost`, browser + node): `combineQuery`
   / `combineStream` gather a field across a peer map, capturing each host's outcome (`HostResult =
   { host, exit }`); `Combine` = `sum`/`collect`/`byHost`/`successes`/`failures`/`mergeStreams`/`mergeByHost`
   (host-tagged). The fold sees every outcome → **dev-controlled** down-host policy.
9. **Fold over leaf fields, add self yourself** — `peers` excludes fleet fields (compile-enforced), and
   you write `pool.activeCount() + others`, so self-inclusion is explicit, never a silent miss.
10. **Tools, not widgets, for custom resources** — the toolkit ships the primitives (`peers`, `Combine`);
    the consumer builds the fold + any widget.

## How it works (mechanism)
- **Serve:** each host runs `serverEntry(Database, impl)` + (where its logic reaches peers)
  `peersLayer(Database, thatHost)`. Hosts connect to peers **only** via `peersLayer`.
- **A combined field is served.** A client calls `totalConnections` on **any** host; that host's layer
  gathers its peers (`peers` clients, over the wire) + its own value and returns the fleet total. So a
  single-host client gets the fleet value — the host did the gather. (Proven: `multi-host-peers-http.test.ts`.)
- **Readiness** stays per-host and local (`/health`); no cross-host hop there.

## Deferred / open
- **Coordinator** — a separate instance-manager (a program/process/resource), *not* an elected instance
  (instances are peers). Doable later; out of scope here.
- **Same-host multiplicity** — the reserved instance-key mechanism, if/when needed.
- **Scale** — the mesh is N×(N−1) connections; fine at league scale. If a fleet grows, push-to-redis
  (each host publishes its own values; a holder reads the aggregate) avoids the mesh. Deferred.

## Shipped surface
- `@nikscripts/effect-pm/MultiHost`: `combineQuery`, `combineStream`, `Combine`, `HostResult`, `HostStream`.
- `Resource`: `Host` (with `url`), `multiHost`, `fleet` / `FleetField`, `peers` / `peersLayer` / `peersFrom`,
  `PeersId`, `AnyHost`, `MissingHostUrl`; `layer` gains the `Effect` form; `Method` is now `Pipeable`.
- Tests: `multi-host.test.ts` (combine core), `multi-host-peers.test.ts` (local + the fleet/peers
  compile-time guard), `multi-host-peers-http.test.ts` (served over http).

## Gutted (do not resurrect from old drafts)
The multi-host **contract field kind** — `Resource.contract(...).pipe(Resource.multi((m) => ({...})))`,
`m.query`/`m.stream`, `MultiField`, `ServiceMultiField`, `InstanceServiceOf`, `MultiServiceOf`,
`Resource.combined` — was removed. Combined fields are plain `fleet`-tagged queries folded in the layer via
`peers`. Slice 1's `/MultiHost` `Combine` primitives are the surviving, reused piece.
