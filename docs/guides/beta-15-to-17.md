# Upgrade guide: beta.15 → beta.17

Three releases that took the toolkit from "serve a custom resource" to "serve **one resource across a
fleet**, with **durable per-host/per-resource logs**." In one arc:

- **beta.15** — custom resources become first-class on a shared host.
- **beta.16** — one resource shape, **N host-local instances** (the multi-host model).
- **beta.17** — makes that production-ready: durable logs, client ergonomics for hostless tags,
  config-driven peer wiring, and the decisions that lock the model's boundaries.

Most of this guide is **beta.17**; the first two sections are quick recaps. Every code sample is
exercised by a test in `test/`.

---

## beta.15 — custom resources, first-class (recap)

- **`Resource.serverEntry(tag, impl)`** — a **spec-checked** `serveAllHttp` entry for a raw
  `Resource.Tag` (a bare `{ tag, impl }` literal is typed `Record<string, unknown>` and checks nothing).
  Two forms: a record (`R = never`) or an `Effect` that builds it carrying a requirement `R`.
- **`serveAllHttp` unions each entry's `R`** — one host can serve queues (worker `R`), `ApiMetrics`
  (`Scope`), and plain resources (`never`) with no `as ServeEntry<never>` per entry.
- **`Resource.withReadiness` accepts a host-bound class** in its data-first form.
- **BREAKING — Prisma storage backend removed.** `…/storage/prisma`, `PrismaRuntimeStorage`, the
  prisma CLI helpers, and the `@prisma/client` peer are gone. Use the **sqlite** or **redis** backend.

## beta.16 — one resource, N hosts (recap)

One resource shape served as N host-local instances (one per host), each with independent state:

```ts
class NwslHost extends Resource.Host<NwslHost>("app/NwslHost", { url: nwslUrl }) {}
class Database extends Resource.Tag<Database>()("app/Database", {
  connections:      Resource.query(Schema.Number),                      // per-instance ("leaf")
  totalConnections: Resource.query(Schema.Number).pipe(Resource.fleet), // combined across the fleet
}).pipe(Resource.multiHost([NwslHost, EbwslHost, WnbaHost])) {}
```

- **`Resource.Host("id", { url })`** — the host carries how to reach it. **`.pipe(Resource.multiHost([…]))`**
  declares the fleet (hostless — every instance an equal peer).
- **A `fleet` field** is a plain query tagged `Resource.fleet`: served + client-visible, but **excluded
  from `Resource.peers`** so a fold can't fan out.
- **`Resource.peers` / `peersLayer` / `peersFrom`** — the opt-in mesh. The layer folds the other hosts'
  leaf clients + its own value; a client calling a fleet field on **any** host gets the whole-fleet value.
- **`Resource.layer` / `serverEntry` gain an `Effect` form** (build the impl effectfully — e.g. resolve
  `peers` once). `Method` is now `Pipeable`.
- **`@nikscripts/effect-pm/MultiHost`** — isomorphic combine core (browser + node): `combineQuery` /
  `combineStream` capture each host's outcome (`HostResult`), then fold with `Combine`
  (`sum` / `byHost` / `failures` / …). A **down host is a captured failed exit, never a thrown gather**.
- **Effect upgraded to `4.0.0-beta.92`.**

---

## beta.17 — production-ready (the focus)

### 1. Durable log storage — by host *or* by resource

Runtime logs are now durably stored and queryable two ways. Add `HostLogs.persistLayer(host)` (durable)
next to `HostLogs.layer` (live stream); it's backed by `RuntimeStorage` (memory / sqlite / redis via
`ProcessStorage`):

```ts
const HostLive = myHost.pipe(
  Effect.provide(HostLogs.layer),                    // live capture + relay (HostLogs.stream)
  Layer.provideMerge(HostLogs.persistLayer("wnba")), // durable, bucketed by host
  Effect.provide(ProcessStorage.layer),              // backs LogStore
);

// later, anywhere with LogStore in context — newest first, [] (not an error) when empty:
yield* HostLogs.byHost("wnba", { limit: 200 })              // every line this host logged
yield* HostLogs.byResource({ queueId: "wnba/BoxScoreQueue" }) // one resource, across hosts
```

`persistLayer` installs a batched capture logger (built at layer-build, so it captures from the start —
no subscription race) that stamps each line with its `host` while preserving the resource's
`processId` / `queueId`, and batches writes via `Stream.groupedWithin`. A host with no `LogStore`
serves the live stream only. **Use `provideMerge`** — `persistLayer` provides no service, so a bare
`provide` would be pruned as unused.

> **For just one resource's logs**, you don't need `HostLogs` at all — set `captureLogs: true` on that
> queue/process + a `HistoryStore` layer, and read its own `logHistory`. `HostLogs` is the whole-host
> firehose; the resource's `logHistory` is per-resource. See [history & persistence](./history-and-persistence.md).

### 2. Read a hostless multi-host tag: `Resource.client(tag, host)`

A hostless `multiHost` tag is N instances, so the **client names which one**:

```ts
Resource.client(FleetDatabase, NwslHost).pipe(Layer.provide(connectHttp(NwslHost)))
```

The transport resolves from the named host, so the layer **requires that host** (satisfied by
`connectHttp`) — enforced at compile time. (Previously a hostless tag only had `client(tag)`, which
needs the ambient `RpcClient.Protocol`; wiring it to a host service failed at runtime with
`Service not found: RpcClient/Protocol`. That's now unrepresentable.) Host-bound tags are unchanged
(`Resource.client(tag)`).

### 3. Name your own host in a `byHost` fold: `Resource.selfHost(tag)`

For a per-host view (`Combine.byHost`), the impl keys its **own** row without hand-threading:

```ts
fleetStatus: Effect.gen(function* () {
  const self  = yield* Resource.selfHost(FleetDatabase);   // the host key I run as
  const peers = yield* Resource.peers(FleetDatabase);
  const byHost = yield* combineQuery(peers, (p) => p.status, Combine.byHost);
  return { ...byHost, [self]: yield* ownStatus };          // own row, keyed consistently
})
```

Provided by `peersLayer` (now bundled — a mesh resource gets it free) or standalone
`Resource.selfHostLayer(tag, self)` (with `peersFrom`, or when a resource keys per host without a mesh).

### 4. Config-driven peer urls: `peersLayer(tag, self, { url })`

`Host.url` stays the **default** (the standard — the host carries how to reach it). Pass a resolver to
**override** per host — env-specific ports, tunnels, or Effect `Config` — falling back to `Host.url`:

```ts
// fail-fast: a missing PEER_URL_<host> surfaces as a typed ConfigError on the layer build
Resource.peersLayer(FleetDatabase, NwslHost, {
  url: (host) => Config.string(`PEER_URL_${host.key}`),
})

// or skip a missing url instead of failing (Config.option → undefined → falls back to Host.url / skip)
Resource.peersLayer(FleetDatabase, NwslHost, {
  url: (host) => Config.string(`PEER_URL_${host.key}`).pipe(Config.option, Effect.map(Option.getOrUndefined)),
})
```

The resolver is effectful, so its **error and requirements flow to the layer** (typed) — a `ConfigError`
becomes a typed layer-build failure you handle, never a defect. A host that resolves to `undefined` and
has no `Host.url` is **skipped** — a partial mesh, never a throw. Omit `options` and nothing changes.

### 5. Locked decision — readiness is per-host

Readiness stays **per-host and local**; a host's `/health` **never** does a cross-host hop (it would be
slow and *cascade* — one host down would make every other report unhealthy). A `fleet` field can
*report* fleet health, but **fleet-aware alerting** ("page if <2/3 live") is a **separate monitor** that
polls a fleet field as a client — observation, not gating. (`multi-host-instances-decisions.md`, #11.)

---

## Migration notes (beta.16 → beta.17)

The log-storage work removed the stranded process-group log paths. If you touched log internals:

| Removed | Replacement |
|---------|-------------|
| `ProcessGroupLogContext`, `layerProcessGroupLogContext` (never provided since process groups were removed) | `HostLogs.persistLayer(host)` |
| `HostLogs.history()` (flat `HistoryStore` bucket) | `HostLogs.byHost(host, …)` / `HostLogs.byResource(…)` (LogStore) |
| `LogAnnotationKeys.groupId` | `LogAnnotationKeys.host` (+ `withHostLogAnnotations`) |

`LogStore` itself is unchanged and still public (`record` / `recordBatch` / `load`). Nothing else in
beta.17 is breaking — the multi-host additions (`client(tag, host)`, `selfHost`, the `peersLayer`
resolver) are all additive and back-compatible.

---

## Deferred to beta.18

One further consumer finding is tracked for **beta.18** (not a blocker at league scale):
**per-resource source layers force `Effect.provide` in tick bodies** — heterogeneous, mutually-exclusive
per-resource sources can't hoist to `serveAllHttp`'s single shared provide without double-enqueue, so
consumers self-provide per tick and trip `strictEffectProvide`. Needs an idiomatic shape for per-resource
source provisioning. See `docs/handoffs/2026-07-01-per-resource-source-provide.md`. (The multi-host
findings in `2026-07-01-wow-sports-multi-host-findings.md` are all resolved in this release.)
