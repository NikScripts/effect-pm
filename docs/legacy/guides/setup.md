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

The package is ESM-only. UI deps are **optional peers**: a server-only consumer pulls none
of React/Ink/recharts.

## 2. What you get (subpaths)

| Import | Purpose |
| --- | --- |
| `…/Resource` | `Resource.Tag` / `Host` / `client` / `connect` / `connectHttp` / **`serve`** / **`serveRemote`** / **`httpServer`** + readiness (**`withReadiness`** / **`readinessOf`** / **`allReady`**) |
| `…/QueueContract` | `queueTag` (light tag), `serve`, `serveRemote`, `layer` for a managed queue |
| `…/Process` | `Process.Tag` (light tag), `schedule` / `window` / `at`, `serve`, `serveRemote`, `layer` for a managed/polling process — plus `Process.Schedule`, a run-windows manager as its own resource |
| `…/ApiMetrics`, `…/ApiUsageSchema`, `…/HttpApiResource` | outbound-API usage observability — an `ApiMetrics.Tag` tap over an `HttpApiResource.Service` client |
| `…/HostStatus` | the reserved host status resource (auto-served by `httpServer`): `status` / `ping` / `logs` |
| `…/Group` | `Group.Tag` — the nestable navigation tree |
| `…/MultiHost` | combine a field across N instances of one resource (`combineQuery` / `combineStream` / `Combine`) — isomorphic |
| `…/HistoryStore`, `…/DurableQueueStore` | history backfill + durable queue |
| `…/ProcessStore`, `…/ProcessStorage`, `…/RuntimeStorage`, `…/Logs` | storage facets + structured logs |
| `…/storage/sqlite` · `/redis` | durable storage backends |
| **`…/cli`** | `makeResourceCli`, `resourcesByName`, `render` — a run-and-exit CLI from your tags |
| **`…/tui`** | the reactive binding + terminal primitives for Ink dashboards |
| **`…/web`** | React widgets + the reactive binding for browser dashboards — incl. the host **`HealthBoard`** (die → degraded resources + per-host cards) and `ResourceReadinessBanner` |

> **Browser bundles:** import the **light** tags from `…/QueueContract` / `…/Process`
> (not the engine layers) so the worker engine + node deps stay out of the browser build.

## 2a. Browser safety & tree-shaking

The package is built for this: ESM-only, `"sideEffects": false`, tsup `treeshake` + code
splitting, and every optional peer (react/recharts/ink/sqlite/redis) externalized. With
an ESM tree-shaking bundler (Vite, esbuild, Rollup, webpack 5) a browser build pulls only what
it imports.

- **Browser-safe (no node built-ins):** `…/web`, `…/Group`, `…/Resource`
  (`client`/`connect`/`connectHttp`/`Host`), `…/MultiHost`, `…/QueueContract` (`queueTag` + contract),
  `…/Process` (`Process.Tag`), `…/cli`, `…/tui`.
- **Node-only — never reach these from browser code:** `…/storage/sqlite` (pulls
  `@effect/sql-sqlite-node`), `…/storage/redis`, and the HTTP
  server itself (`NodeHttpServer`) plus any worker/storage layers. (`httpServer` / `serve`
  are clean to *reference*, but they belong to the server entry.)

**The rule that actually bites:** keep the **contract** (light tags) in a different module from
the **implementation** (engine layers, storage, worker `effect`s, the server). A module that
defines a tag *and* imports its `QueueResource.layer` / `Resource.httpServer` / a storage layer is
node-coupled — importing it in the browser just to get the tag drags the whole server in.

```ts
// fleet.ts — BROWSER-SAFE: tags + hosts + groups only (light contracts)
export class LeagueHost extends Resource.Host<LeagueHost>("nwsl/host") {}
export class Roster extends queueTag<Roster>()("nwsl/Roster", Job, { host: LeagueHost }) {}
export class Nwsl extends Group.Tag<Nwsl>("nwsl")({ Roster }) {}

// server.ts — NODE: imports fleet.ts + the engine / storage / HTTP server
import { Roster } from "./fleet";
const Server = Resource.httpServer([queueServe(Roster, { effect })]).pipe(/* storage + NodeHttpServer */);
```

The browser imports `fleet.ts` (tags) + `…/web` + `Resource.client` / `connectHttp`; the server
imports `fleet.ts` + the layers. Same tags, no leak. Prefer specific subpaths over the root
barrel in browser code — the barrel is node-safe but reaches the whole toolkit (~260 KB of
chunks before shaking).

**Diagnose a leak:** build, grep the client bundle for `node:` / `better-sqlite3`, then use your
bundler's import-chain view (Vite `--debug`, `rollup-plugin-visualizer`) — the chain almost
always ends at a shared module that pulls a server/storage layer.

## 2b. Styling the web widgets (Tailwind)

The `…/web` widgets are shadcn-style — Tailwind utility classes plus CSS-variable theme tokens.
Tailwind **does not scan `node_modules` by default**, so two things must be wired up in the
consumer or the widgets render unstyled:

1. **Scan the package** so the utilities used inside the widgets get generated.

   Tailwind v4 (in your CSS):

   ```css
   @import "tailwindcss";
   @source "../node_modules/@nikscripts/effect-pm/dist";
   ```

   Tailwind v3 (`tailwind.config`):

   ```js
   content: ["./src/**/*.{ts,tsx}", "./node_modules/@nikscripts/effect-pm/dist/**/*.js"],
   ```

2. **Define the theme tokens** the widgets reference (`--card`, `--muted-foreground`, `--border`,
   `--primary`, `--accent`, `--destructive`, `--ring`, `--radius`, …) plus the `.safe-area` class
   (device-inset padding) and the view-transition keyframes the drill-down uses. The shipped
   `src/web/theme.css` carries all of these (a dark ops theme) — import it, or copy its `@theme
   inline` + `:root` + `.safe-area` + `::view-transition-*` blocks. Without `.safe-area` the
   dashboard renders edge-to-edge with no margins.

3. **Install the optional peer deps the widgets use:** `react` / `react-dom`, `recharts` (the
   metric charts), and — for the API resource's endpoint table — `@tanstack/react-table`. They're
   declared as optional peers; `/web` imports them, so install the ones for the widgets you render.

Symptom map: widgets render **unstyled** → #1 (Tailwind didn't see the classes in `node_modules`);
render but **wrong / missing colours / no margins** → #2 (theme tokens / `.safe-area` not defined);
**module-not-found** at runtime → #3 (a peer dep isn't installed).

## 3. Define resources, bound to a host

A `Host` lets a group of resources be served on one port (§4) and reached over one transport (§5).

```ts
import { Schema } from "effect";
import { Resource } from "@nikscripts/effect-pm/Resource";
import { queueTag } from "@nikscripts/effect-pm/QueueResource";
import * as Process from "@nikscripts/effect-pm/Process";
import { Group } from "@nikscripts/effect-pm/Group";

export class LeagueHost extends Resource.Host<LeagueHost>("nwsl/host") {}

const Job = Schema.Struct({ id: Schema.String });
export class RosterQueue extends queueTag<RosterQueue>()("nwsl/Roster", Job, { host: LeagueHost }) {}
export class SeasonMatches extends Process.Tag<SeasonMatches>()("nwsl/Season", { host: LeagueHost }) {}

// the navigation tree — members may be nested groups or live on different hosts
export class Nwsl extends Group.Tag<Nwsl>("nwsl")({ RosterQueue, SeasonMatches }) {}
```

## 4. Serve a host's group on one port

`httpServer` mounts every resource of a host on one `/rpc` endpoint (procedures are
group-id-prefixed). Each `serve` layer carries its resource's worker requirement `R`.

```ts
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Resource } from "@nikscripts/effect-pm/Resource";
import { serve as queueServe } from "@nikscripts/effect-pm/QueueResource";
import { serve as processServe } from "@nikscripts/effect-pm/Process";
import { HistoryStore } from "@nikscripts/effect-pm/HistoryStore";
import * as Logs from "@nikscripts/effect-pm/Logs";
import * as ProcessStorage from "@nikscripts/effect-pm/ProcessStorage";

const LeagueServer = Resource.httpServer([
  queueServe(RosterQueue, { effect: (job) => loadRoster(job) }),
  processServe(SeasonMatches, { effect: pollSeason }),
]).pipe(
  Layer.provide(HistoryStore.layerMemory()), // metrics.query backfill (or SQLiteHistoryStore)
  Layer.provide(Logs.layer),
  Layer.provide(Logs.persistLayer(LeagueHost)),
  Layer.provide(ProcessStorage.layer),       // LogStore backend for durable logs
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: 3001 })),
);

NodeRuntime.runMain(Layer.launch(LeagueServer));
```

Provide your domain layers (whatever the worker `effect`s require) alongside the server.
A single-resource host is just `httpServer([serve(tag, impl)])` without a `Host`.

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
`…/Process`) rather than a client — the call sites don't change.

## 6. Drive them

### CLI (`…/cli`)

```ts
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { makeResourceCli, resourcesByName } from "@nikscripts/effect-pm/cli";

const cli = makeResourceCli(resourcesByName([RosterQueue, SeasonMatches]), "hub");
// hub RosterQueue status.get · hub RosterQueue pause · hub SeasonMatches start · hub ls
NodeRuntime.runMain(
  Command.runWith(cli, { version: "0.0.0" })(process.argv.slice(2)).pipe(
    Effect.provide(clients),
    Effect.provide(NodeServices.layer),
  ) as Effect.Effect<void, unknown>,
);
```

Each contract query/mutate becomes a verb (flags from the payload schema); streams are
skipped — use their one-shot peers (`status.get`, `metrics.query`). Per-resource logs are
read via `Resource.logs` / `NodeStatus.logs` (see [`docs/LOGS.md`](../../LOGS.md)), not as
CLI stream verbs on the resource contract.

### Web (`…/web`) and TUI (`…/tui`)

Both render off the **same** reactive binding (Ink is React). Provide an `AtomRegistry` via
`RegistryProvider`, build atoms from a tag (status / metrics / logs streams + controls) over
`clients`, and read them with `useAtomValue` / drive controls with `useAtomSet`. Compose web
widgets from `@nikscripts/effect-pm/web`, or terminal widgets from `@nikscripts/effect-pm/tui`
(`bar`, `spark`, `compact`, `statusColor`, …). The `examples/web-dashboard` and
`examples/resource-tui` trees (shipped in the package) are the working reference — copy their
`queue-data` data layer and widgets as a starting point.

The batteries-included `<Dashboard runtime={Atom.runtime(layer)} group={Root} />` renders the
responsive drill-down directly from a `Group.Tag` tree: a **hand-crafted widget per resource
type** — queue (cards + chart + controls + logs), scheduled process (controls + a schedule editor
with a fullscreen weekly view), and API-metrics (a paged card + usage chart + sortable endpoint
table). It classifies each leaf by the contract's **stamped kind** (`Resource.kindOf` — see the
[Resource API](../RESOURCE-API.md#resource-kinds)), not by sniffing the spec, so a new contract in
the tree renders as itself rather than a mis-typed cell. The `examples/resource-web` tree (one of
each unique thing) is the working reference.

> Keep concurrent live streams per view ≤ ~5: a browser caps an origin at ~6 HTTP/1.1
> connections, so derive related views from one stream (see the example data layer) rather
> than opening a stream per atom.

## 7. Persistence

Opt in where you need durability or history: `persist` on a queue, `HistoryStore` /
`SQLiteHistoryStore` for `*History` backfill, and the storage backends under `…/storage/*`.
See [history-and-persistence.md](./history-and-persistence.md).

---

Reference: [toolkit-by-example.md](./toolkit-by-example.md) (every pattern by example),
[docs/RESOURCE-API.md](../RESOURCE-API.md), [docs/handoffs/archive/2026-07/features/ui-serve-all-http.md](../../handoffs/archive/2026-07/features/ui-serve-all-http.md).
