# Handoff (UI agent): `serveAllHttp` — serve a group on one port

**Status:** shipped on `main` (built on beta.6, additive — nothing of yours changed; the rebase was
clean). This note is what the **web / TUI / CLI** side should know to take advantage of it.

## What's new

`Resource.serveAllHttp` + `QueueResource.serverEntry` / `ScheduledProcess.serverEntry` serve a
**whole group of resources on one HTTP port behind one `Host`**. Until now the only built-in serve
path was one `serveHttp` (= one `RpcServer`) per resource. Procedures are group-id-prefixed, so many
resources coexist on the one `/rpc` endpoint without collision.

This completes the **multi-host** model you already built (the "KeyRotation on a separate Mini
server" topology): a host can now be **a group of resources on one port**, not one resource per port
— which is exactly wow's production deploy shape (one port per league).

## Client side — no API change, just consolidation

Your data layer already uses `Resource.client(Tag)` + `Resource.connectHttp(Host)`, and that is
**unchanged**. The opportunity: where a host now serves many resources via `serveAllHttp`, provide
**one** transport for the whole group instead of one per resource:

```ts
const FleetClients = Layer.mergeAll(
  Resource.client(RosterQueue),
  Resource.client(SeasonMatches),
  Resource.client(KeyRotation),
).pipe(Layer.provide(Resource.connectHttp(LeagueHost, { url: `${base}/rpc` })));
```

The environment-aware transport you built (TUI/Node reusing the web data layer) works the same — the
only thing that shrinks is the number of `connectHttp` transports.

## Server side — the new pattern

```ts
class LeagueHost extends Resource.Host<LeagueHost>("nwsl/host") {}
class RosterQueue extends QueueResource.Tag<RosterQueue>()("nwsl/Roster", Item, { host: LeagueHost }) {}
class SeasonMatches extends ScheduledProcess.Tag<SeasonMatches>()("nwsl/Season", { host: LeagueHost }) {}

const LeagueServer = Resource.serveAllHttp([
  QueueResource.serverEntry(RosterQueue, { effect, itemSchema, captureLogs: true }),
  ScheduledProcess.serverEntry(SeasonMatches, { effect }),
]).pipe(Layer.provideMerge(NodeHttpServer.layer({ port: 3001 })));
```

`serverEntry` carries each resource's worker requirement `R`, so the served layer requires
`R | HttpServer` — provide your domain layers + the Node server.

## Action items

1. **Bind example/demo tags to a `Host`** — `Tag<T>()("id", schema, { host: SomeHost })`. Required
   to serve via `serveAllHttp`. (Single-resource `serveHttp` still works without a host — this is
   opt-in.)
2. **Migrate the example servers** (`queue-server` / the dashboard's serve-side) from
   one-port-per-resource to **one `serveAllHttp` per host**, so the dashboard demo mirrors wow's
   production topology (one port per league/host). Then collapse the matching client transports.
3. **Multi-host dashboard:** model each Host as a served group; the dashboard already walks a
   `Group.Tag` tree — a group whose members share a `Host` now maps to one served port.

## Reference

- Tests: `test/serve-all-queues.test.ts` (two real queue engines, one Host, one port) and
  `test/serve-all-http.test.ts` (plain resources).
- The production target this mirrors: `apps/services-hub/EFFECT-PM-MIGRATION.md` Step 4 in the wow
  repo (the deploy shape the dashboard is being built for).
- API: `src/Resource.ts` (`serveAllHttp`, `ServeEntry`), `src/QueueContract.ts` +
  `src/ScheduledProcess.ts` (`serverEntry`).
