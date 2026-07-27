# Decisions: one resource, N host-local instances (multi-host)

**Status:** the core is **SHIPPED** on `cursor/multi-host-instances` (peers model). This doc is the SSOT —
build from it, don't regenerate shapes from chat. Earlier drafts explored a "multi-host contract field
kind" (`m.query`/`m.stream`/`Hyperlink.combined`) — that was **gutted**; combined fields are plain queries
implemented via `Hyperlink.peers`. Exploration input: `multi-host-instances.md` (wow-sports).

## The need
One resource **shape** (e.g. `Database`) served as **N instances**, one per host (`Database` on
`NwslHost` / `EbwslHost` / `WnbaHost`): same contract, independent state + readiness, each served locally.
The consumer holds **one class**, never N. It's "one resource, N instances," not "N resources."

## The shape (shipped)
```ts
// hosts carry their own url
class NwslHost extends Hyperlink.Host<NwslHost>("nwsl", { url: nwslUrl }) {}
// … EbwslHost, WnbaHost

// contract — plain fields; combined fields are plain queries tagged `fleet`. The fleet is piped on
// with `multiHost([hosts])` — hostless, every instance an equal peer, no "primary" host.
class Database extends Hyperlink.Tag<Database>()("app/Database", {
  connections:      Hyperlink.query(Schema.Number),
  totalConnections: Hyperlink.query(Schema.Number).pipe(Hyperlink.fleet),
}).pipe(
  Hyperlink.multiHost([NwslHost, EbwslHost, WnbaHost]),
) {}

// layer — the Effect form: resolve peers once; totalConnections folds peers + self
const database = Hyperlink.layer(
  Database,
  Effect.gen(function* () {
    const peers = yield* Hyperlink.peers(Database);
    return {
      connections: Effect.sync(() => pool.activeCount()),
      totalConnections: combineQuery(peers, (p) => p.connections, Combine.sum).pipe(
        Effect.map((others) => pool.activeCount() + others),
      ),
    };
  }),
);

// serve a host: the layer + the peers capability (opt-in mesh) + an http server
Hyperlink.serveAllHttp([Hyperlink.serverEntry(Database, databaseImpl)]).pipe(
  Layer.provide(Hyperlink.peersLayer(Database, NwslHost)),
  Layer.provideMerge(NodeHttpServer.layer({ port })),
);
// a client → any host → totalConnections → that host gathers peers + self → the fleet total.
```

## Locked decisions
1. **Groups only organize.** One tag = one group node; same-tag-at-multiple-positions = a cross-link
   (one identity, many nav paths), never the instance mechanism. Instance count is a runtime fact.
2. **The `Host` carries its url** (`Hyperlink.Host("id", { url })`), and the fleet is piped on with
   `.pipe(Hyperlink.multiHost([hosts]))` — hostless, no primary; every instance is an equal peer. (It's
   `Fn.dual` with data-first overloads, which is what lets it pipe in a class-`extends` position without
   the tag recursing on its own type; `multiHost` takes an **array**.) So the tag is self-describing
   (fleet + each host's url). `connectHttp` reads `host.url` (an explicit arg overrides); neither →
   `MissingHostUrl`.
   - **Bright line (plain TS, not toolkit-specific):** a combinator's callback in the class-`extends`
     base must not reference the class being defined — e.g. don't put `readinessOf(Database)` inside
     `Database`'s own `withReadiness` (a class can't mention itself in its own base). Referencing a
     *peer* tag (`readinessOf(ScoresDb)` from another resource) is fine. Nothing else about piping —
     hostless, host-bound, `multiHost` + `withReadiness` together — recurses.
3. **A server layer per host** — each host runs the same `serverEntry(Database, impl)`. Not
   "one-serves-the-rest."
4. **No instance suffix** for multi-host — the host (transport) is the discriminator. The key/suffix is
   reserved for **same-host** multiplicity (deferred).
5. **Combined fields are plain queries, tagged `Hyperlink.fleet`.** `Hyperlink.fleet(method)` (or
   `query(...).pipe(Hyperlink.fleet)`) marks a field as combined-across-the-fleet: served + client-visible
   like any query, but **excluded from `peers`** (`PeerServiceOf`) so a fold can't call a peer's own fleet
   field (fan-out). The one lightweight tag the plain-query model keeps.
6. **`Hyperlink.layer` has an `Effect` form (layer-from-effect).** Build the impl effectfully — acquire a
   pool, **resolve `peers` once** — and its requirement `R` becomes the layer's (members close over what
   they need, stay `R = never`). Provide `R` (e.g. `peersLayer`) alongside. Mirrors `serverEntry`'s two
   forms; `serverLayer`/`serveHttp`/`serveAllHttp` carry `R` via the `serverEntry` Effect form.
7. **`peers` is the opt-in mesh.** `Hyperlink.peers(tag)` yields the other hosts' **leaf** clients (keyed
   by host), for the resource's own cross-host logic. `Hyperlink.peersLayer(tag, self)` connects the
   `multiHost` set (minus self) via each `Host.url`; `Hyperlink.peersFrom(tag, clients)` provides an
   explicit client map (a holder's bundles, or a test). Connections from a host to its peers exist **only**
   where you provide `peersLayer` — nowhere else meshes.
8. **Combine primitives are isomorphic** (`hyperlink-ts/MultiHost`, browser + node): `combineQuery`
   / `combineStream` gather a field across a peer map, capturing each host's outcome (`HostResult =
   { host, exit }`); `Combine` = `sum`/`collect`/`byHost`/`successes`/`failures`/`mergeStreams`/`mergeByHost`
   (host-tagged). The fold sees every outcome → **dev-controlled** down-host policy.
9. **Fold over leaf fields, add self yourself** — `peers` excludes fleet fields (compile-enforced), and
   you write `pool.activeCount() + others`, so self-inclusion is explicit, never a silent miss.
10. **Tools, not widgets, for custom resources** — the toolkit ships the primitives (`peers`, `Combine`);
    the consumer builds the fold + any widget.
11. **Readiness is per-host and local — `/health` never does a cross-host hop.** (Agreed 2026-07-01, from
    wow-sports finding #4.) A `fleet` field can *report* fleet health, but readiness that gates a host's
    `/health` stays local. Rationale: a health check that reached peers would be slow **and cascade** —
    one host down would make every other host report unhealthy over RPC, a false fleet-wide outage; and
    `/health` must stay fast + dependency-free. **Fleet-aware alerting** ("page if <2/3 DBs live") is a
    *separate monitor* that polls a `fleet` field **as a client** and alerts — observation, not gating.
    So there's a clear path for fleet health (a monitor), and a firm boundary at `/health` (local only).
    Not a silent gap; a deliberate line. If fleet-gated `/health` is ever truly wanted it needs a new,
    explicit opt-in — do not add it implicitly.

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
- `hyperlink-ts/MultiHost`: `combineQuery`, `combineStream`, `Combine`, `HostResult`, `HostStream`.
- `Hyperlink`: `Host` (with `url`), `multiHost`, `fleet` / `FleetField`, `peers` / `peersLayer` / `peersFrom`,
  `PeersId`, `AnyHost`, `MissingHostUrl`; `layer` gains the `Effect` form; `Method` is now `Pipeable`.
- Tests: `multi-host.test.ts` (combine core), `multi-host-peers.test.ts` (local + the fleet/peers
  compile-time guard), `multi-host-peers-http.test.ts` (served over http).

## Gutted (do not resurrect from old drafts)
The multi-host **contract field kind** — `Hyperlink.contract(...).pipe(Hyperlink.multi((m) => ({...})))`,
`m.query`/`m.stream`, `MultiField`, `ServiceMultiField`, `InstanceServiceOf`, `MultiServiceOf`,
`Hyperlink.combined` — was removed. Combined fields are plain `fleet`-tagged queries folded in the layer via
`peers`. Slice 1's `/MultiHost` `Combine` primitives are the surviving, reused piece.
