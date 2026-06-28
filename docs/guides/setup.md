# Setup — consuming `@nikscripts/effect-pm`

How to install the package in another app (e.g. `services-hub`) and stand up resources, a
server, and a CLI / TUI / web dashboard against them. For the *patterns* (defining queues,
processes, schedules, groups, hosts) see [toolkit-by-example.md](./toolkit-by-example.md);
this guide is the install + wiring checklist.

## 1. Install

```bash
npm install @nikscripts/effect-pm effect
```

`effect` is a required peer. Add the others only for the surfaces you use:

| If you use… | also install |
| --- | --- |
| any resource / server / `/cli` | *(nothing extra — `effect` covers it, incl. `effect/unstable/cli`)* |
| `@nikscripts/effect-pm/tui` | `react`, plus **`ink`** (yours — `/tui` ships primitives + the binding, not Ink) |
| `@nikscripts/effect-pm/web` | `react`, `react-dom`, `recharts`, `@tanstack/react-table`, `@tanstack/react-query` |
| `@nikscripts/effect-pm/storage/sqlite` | `@effect/sql-sqlite-node` |
| `@nikscripts/effect-pm/storage/prisma` | `@prisma/client` (your generated client) |

The package is ESM-only. UI deps are **optional peers**: a server-only consumer pulls none
of React/Ink/recharts.

## 2. What you get (subpaths)

| Import | Purpose |
| --- | --- |
| `…/Resource` | `Resource.Tag` / `Host` / `client` / `connect` / `connectHttp` / `serveHttp` / **`serveAllHttp`** / `serverEntry`-host wiring |
| `…/QueueContract` | `queueTag` (light tag), `serverEntry`, `serveHttp`, `layer` for a managed queue |
| `…/ScheduledProcess` | `processTag` (light tag), `serverEntry`, `serveHttp`, `layer` for a scheduled/polling process |
| `…/ProcessScheduleContract` | `processScheduleTag` — a schedule (run-windows) as its own resource |
| `…/Group` | `Group.Tag` — the nestable navigation tree |
| `…/HistoryStore`, `…/DurableQueueStore` | history backfill + durable queue |
| `…/ProcessStore`, `…/ProcessStorage`, `…/RuntimeStorage`, `…/Logs` | storage facets + structured logs |
| `…/storage/sqlite` · `/redis` · `/prisma` | durable storage backends |
| **`…/cli`** | `makeResourceCli`, `resourcesByName`, `render` — a run-and-exit CLI from your tags |
| **`…/tui`** | the reactive binding + terminal primitives for Ink dashboards |
| **`…/web`** | React widgets + the reactive binding for browser dashboards |

> **Browser bundles:** import the **light** tags from `…/QueueContract` / `…/ScheduledProcess`
> (not the engine namespaces) so the worker engine + node deps stay out of the browser build.

## 2a. Browser safety & tree-shaking

The package is built for this: ESM-only, `"sideEffects": false`, tsup `treeshake` + code
splitting, and every optional peer (react/recharts/ink/sqlite/prisma/redis) externalized. With
an ESM tree-shaking bundler (Vite, esbuild, Rollup, webpack 5) a browser build pulls only what
it imports.

- **Browser-safe (no node built-ins):** `…/web`, `…/Group`, `…/Resource`
  (`client`/`connect`/`connectHttp`/`Host`), `…/QueueContract` (`queueTag` + contract),
  `…/ScheduledProcess` (`processTag`), `…/ProcessScheduleContract`, `…/cli`, `…/tui`.
- **Node-only — never reach these from browser code:** `…/storage/sqlite` (pulls
  `@effect/sql-sqlite-node`), `…/storage/redis`, `…/storage/prisma`, `…/prisma`, and the HTTP
  server itself (`NodeHttpServer`) plus any worker/storage layers. (`serveAllHttp` / `serverEntry`
  are clean to *reference*, but they belong to the server entry.)

**The rule that actually bites:** keep the **contract** (light tags) in a different module from
the **implementation** (engine layers, storage, worker `effect`s, the server). A module that
defines a tag *and* imports its `QueueResource.layer` / `serveAllHttp` / a storage layer is
node-coupled — importing it in the browser just to get the tag drags the whole server in.

```ts
// fleet.ts — BROWSER-SAFE: tags + hosts + groups only (light contracts)
export class LeagueHost extends Resource.Host<LeagueHost>("nwsl/host") {}
export class Roster extends queueTag<Roster>()("nwsl/Roster", Job, { host: LeagueHost }) {}
export class Nwsl extends Group.Tag<Nwsl>("nwsl")({ Roster }) {}

// server.ts — NODE: imports fleet.ts + the engine / storage / HTTP server
import { Roster } from "./fleet";
const Server = Resource.serveAllHttp([queueEntry(Roster, { effect })]).pipe(/* storage + NodeHttpServer */);
```

The browser imports `fleet.ts` (tags) + `…/web` + `Resource.client` / `connectHttp`; the server
imports `fleet.ts` + the layers. Same tags, no leak. Prefer specific subpaths over the root
barrel in browser code — the barrel is node-safe but reaches the whole toolkit (~260 KB of
chunks before shaking).

**Diagnose a leak:** build, grep the client bundle for `node:` / `better-sqlite3`, then use your
bundler's import-chain view (Vite `--debug`, `rollup-plugin-visualizer`) — the chain almost
always ends at a shared module that pulls a server/storage layer.

## 3. Define resources, bound to a host

A `Host` lets a group of resources be served on one port (§4) and reached over one transport (§5).

```ts
import { Schema } from "effect";
import { Resource } from "@nikscripts/effect-pm/Resource";
import { queueTag } from "@nikscripts/effect-pm/QueueContract";
import { processTag } from "@nikscripts/effect-pm/ScheduledProcess";
import { Group } from "@nikscripts/effect-pm/Group";

export class LeagueHost extends Resource.Host<LeagueHost>("nwsl/host") {}

const Job = Schema.Struct({ id: Schema.String });
export class RosterQueue extends queueTag<RosterQueue>()("nwsl/Roster", Job, { host: LeagueHost }) {}
export class SeasonMatches extends processTag<SeasonMatches>()("nwsl/Season", { host: LeagueHost }) {}

// the navigation tree — members may be nested groups or live on different hosts
export class Nwsl extends Group.Tag<Nwsl>("nwsl")({ RosterQueue, SeasonMatches }) {}
```

## 4. Serve a host's group on one port

`serveAllHttp` mounts every resource of a host on one `/rpc` endpoint (procedures are
group-id-prefixed). `serverEntry` carries each resource's worker requirement `R`.

```ts
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Resource } from "@nikscripts/effect-pm/Resource";
import { serverEntry as queueEntry } from "@nikscripts/effect-pm/QueueContract";
import { serverEntry as processEntry } from "@nikscripts/effect-pm/ScheduledProcess";
import { HistoryStore } from "@nikscripts/effect-pm/HistoryStore";

const LeagueServer = Resource.serveAllHttp([
  queueEntry(RosterQueue, { effect: (job) => loadRoster(job), captureLogs: true }),
  processEntry(SeasonMatches, { effect: pollSeason }),
]).pipe(
  Layer.provide(HistoryStore.layerMemory()), // backfill for `*History` (or SQLiteHistoryStore)
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 3001 })),
);

NodeRuntime.runMain(Layer.launch(LeagueServer));
```

Provide your domain layers (whatever the worker `effect`s require) alongside the server.
A single-resource host can still use `serveHttp(tag, impl)` without a `Host`.

## 5. Reach them — location-transparent client

The same `yield* Tag` code runs local or remote; only the provided layer changes. One
transport per host:

```ts
import { Layer } from "effect";
import { Resource } from "@nikscripts/effect-pm/Resource";

const base = "http://your-host:3001";
const clients = Layer.mergeAll(
  Resource.client(RosterQueue),
  Resource.client(SeasonMatches),
).pipe(Layer.provide(Resource.connectHttp(LeagueHost, { url: `${base}/rpc` })));

// anywhere with `clients` provided:
//   const q = yield* RosterQueue; yield* q.add({ id });
//   const p = yield* SeasonMatches; yield* p.start;
```

To run a resource **in-process** instead, provide its `.layer` (from `…/QueueContract` /
`…/ScheduledProcess`) rather than a client — the call sites don't change.

## 6. Drive them

### CLI (`…/cli`)

```ts
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { makeResourceCli, resourcesByName } from "@nikscripts/effect-pm/cli";

const cli = makeResourceCli(resourcesByName([RosterQueue, SeasonMatches]), "hub");
// hub RosterQueue statusNow · hub RosterQueue pause · hub SeasonMatches start · hub ls
NodeRuntime.runMain(
  Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(
    Effect.provide(clients),
    Effect.provide(NodeServices.layer),
  ) as Effect.Effect<void, unknown>,
);
```

Each contract query/mutate becomes a verb (flags from the payload schema); streams are
skipped — use their one-shot peers (`statusNow`, `logHistory`).

### Web (`…/web`) and TUI (`…/tui`)

Both render off the **same** reactive binding (Ink is React). Provide an `AtomRegistry` via
`RegistryProvider`, build atoms from a tag (status / metrics / logs streams + controls) over
`clients`, and read them with `useAtomValue` / drive controls with `useAtomSet`. Compose web
widgets from `@nikscripts/effect-pm/web`, or terminal widgets from `@nikscripts/effect-pm/tui`
(`bar`, `spark`, `compact`, `statusColor`, …). The `examples/web-dashboard` and
`examples/resource-tui` trees (shipped in the package) are the working reference — copy their
`queue-data` data layer and widgets as a starting point.

> Keep concurrent live streams per view ≤ ~5: a browser caps an origin at ~6 HTTP/1.1
> connections, so derive related views from one stream (see the example data layer) rather
> than opening a stream per atom.

## 7. Persistence

Opt in where you need durability or history: `persist` on a queue, `HistoryStore` /
`SQLiteHistoryStore` for `*History` backfill, and the storage backends under `…/storage/*`.
See [history-and-persistence.md](./history-and-persistence.md).

---

Reference: [toolkit-by-example.md](./toolkit-by-example.md) (every pattern by example),
[docs/RESOURCE-API.md](../RESOURCE-API.md), [docs/handoffs/ui-serve-all-http.md](../handoffs/ui-serve-all-http.md).
