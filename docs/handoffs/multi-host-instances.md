# Exploration (THEORETICAL — no API decided): one resource, many host-local instances

> ⚠️ **Nothing here is a proposed API.** Every code block is a sketch to think against, not a
> recommendation. What's firm is the **need** and the **invariants**; the shape is wide open. Captured
> from a wow-sports design discussion (Database / Import / EventManager monitoring).

## The need

A monitorable resource like `Database` is **one service** — one shape: a `status` snapshot + a
readiness derivation. But it must exist as **many instances of that one shape**, one per league serve
(`Database#nwsl`, `Database#ebwsl`, `Database#wnba`), each:

- **the same shape** (not distinct services — they're identical in structure),
- **independent state + readiness** (one process's pool can be down while the others are fine),
- **served locally on its own host** (each serve pings its own Postgres pool; no cross-host hop),
- folded into **that host's** `/health`.

The count is incidental (three leagues today; could be `main` + `cms` DBs tomorrow, possibly several
on one host). What matters is "one resource, N instances of one shape," **not** "N resources."

## Why the two shapes that exist today don't fit

| Shape                                                                                    | What it is                                | Why it's wrong here                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instance family** (`Resource.instance` + `serveInstances`/`clientInstances`, `tagFor`) | One resource, many instances of one shape | Serves them **all on one host**, dispatched by a per-call **key header** → the centralized single-host routing we explicitly don't want (every host's instance funnels through the one that owns the RPC group). |
| **Per-instance host-bound tags** (where `ApiMetrics` landed)                             | `class X extends Tag<X>()(id, …, {host})` | These are **distinct tags = distinct services**. Right shape, wrong identity — three services, not three instances of one.                                                                                       |

The thing in the middle — _instances of **one** resource, distributed across hosts, each served
locally with independent readiness_ — has no expression today. (wow currently fakes it with three
hand-written host-bound `*Database` tags, which is exactly the "distinct services" anti-shape.)

## Invariants any design must hold (these are firm; the API is not)

1. **One definition** — one id, one spec, one readiness derivation, written once.
2. **N instances of identical shape**, each with independent state + readiness.
3. **Each instance served on its host** locally; its readiness folds into **that host's** `/health`
   (no cross-host hop, no single point).
4. **Dashboard renders one resource with N host facets** — not N separate cards, not one centralized
   card.
5. **The client addresses an instance** (by host, and/or by an explicit key).

## Directions to explore

### A — Host **inheritance**: a host-relative resource _(requested)_

The tag declares **no fixed host**; it inherits the host of whatever `serveAllHttp` (or group) it's
placed in. One definition, added to each host's serve, yields a host-local instance per serve.

```ts
// THEORETICAL — host is contextual, not on the tag:
class Database extends Resource.Tag<Database>()("app/Database", databaseSpec, { readiness }) {}

NwslHost.serveAllHttp([ …, Resource.localInstance(Database, databaseStatus) ]); // ← becomes Database#nwsl
EbwslHost.serveAllHttp([ …, Resource.localInstance(Database, databaseStatus) ]); // ← Database#ebwsl
// client: Resource.client(Database, NwslHost)  // host supplied at the client, since the tag has none
```

- Wire key would need to be host-scoped (`<hostKey>/<id>`) — **the exact mechanism host-bound
  `ApiMetrics` tags already use** (`<hostKey>/<clientId>/metrics`), so collisions are a solved problem.
- ~~Open: with no host on the tag, how does `Resource.client` name the host?~~ **Resolved (beta.17):**
  an **explicit arg** — `Resource.client(tag, host)`. A hostless resource is N instances, so the client
  names which one; the transport resolves from that host (like a host-bound tag), so the layer requires
  the host (satisfied by `connectHttp(host)`) — enforced at compile time, no runtime "Service not
  found". See `test/multi-host-hostless-client.test.ts`.

### B — A helper that **builds the layers** _(requested)_

Rather than hand-wiring each host's serve + client, one call fans an instance across a set of hosts
and returns the serve entries / client layers.

```ts
// THEORETICAL:
const { serveEntries, clients } = Resource.instancesAcrossHosts(Database, [
  { host: NwslHost, impl: databaseStatus },
  { host: EbwslHost, impl: databaseStatus },
  { host: WnbaHost, impl: databaseStatus },
]);
// drop serveEntries[host] into each host's serveAllHttp; merge clients for the dashboard.
```

Composes with **A**: if the resource is host-relative, the helper is just "fan this out to these
hosts." The impl is usually identical across hosts (here `databaseStatus`), so the helper might take
one impl + a host list.

### C — A host **set** / replication framing _(idea)_

Declare the hosts as a set, then "replicate this resource across the set." Ties "inherit a host" to a
named group and gives the dashboard its grouping for free.

```ts
// THEORETICAL:
const LeagueHosts = Resource.HostSet(NwslHost, EbwslHost, WnbaHost);
Resource.replicate(Database, LeagueHosts, databaseStatus); // serve + client + grouping in one move
```

### D — The unifying observation _(idea — probably the most promising)_

The gap may not be a new concept at all — it's making the **existing instance family host-aware.**
Today an instance is keyed by a header and served on one shared host. If an instance could instead:

- carry an **identity that is `(resourceId, key)`** where `key` defaults to a **host** but can be an
  explicit string, and
- be **served where it lives** (on a host's `serveAllHttp`) rather than only via the shared
  `serveInstances`,

then _both_ shapes fall out of one mechanism:

- `key = host`, served per-host → **this** use case (one-per-host, local readiness).
- `key = arbitrary`, served on one host → today's `serveInstances` (and >1 instance on a single host,
  e.g. `main` + `cms` DB on the same serve, also works).

So "multi-host instances" might be "the instance family, re-keyable by host and servable locally."
This subsumes A/B/C as ergonomics over one primitive.

## Cross-cutting open questions

- **Identity / keying.** `(resourceId, hostKey)` vs `(resourceId, key)` with host as the default key.
  Reuse the host-scoped key scheme `ApiMetrics` already ships.
- **Client addressing.** By a host-scoped transport, or an explicit `Resource.client(tag, host)` arg.
- **Dashboard.** Group by `resourceId`, list host instances + each one's readiness; is there a
  cross-host "resource overall" rollup _view_ (dashboard-only — `/health` stays per-host)?
- **Same-host multiplicity.** Must it also allow >1 instance of the resource on one host? (D handles
  this; A/B as written assume one-per-host.)
- **Migration.** Relationship to `serveInstances` (deprecate / coexist) and to the per-instance
  host-bound tags (`ApiMetrics`) — do those become `key = host`/`key = clientId` cases of D?
- **Readiness.** Each host instance's readiness is local and independent (invariant 3). Confirmed no
  aggregation at `/health`; any rollup is a dashboard concern.

## Consumer (what wires this)

wow-sports' `Database` (live), and the planned `Import` / `EventManager` — each is one resource shape
with an instance per league serve. Today: three hand-written host-bound tags per resource. With any
of the above: one definition + a fan-out. See `apps/services-hub/docs/MONITORABLE-RESOURCES-PLAN.md`.

## Related

- `2026-06-29-wow-sports-findings.md` — the index of shipped fixes (#3/#4/#5).
- `withreadiness-host-bound-tags.md` — host-bound readiness (shipped); the per-host readiness this needs.
- `resource-serverentry-for-custom-resources.md` — typed `serverEntry` (shipped beta.15); the serve
  primitive a fan-out helper would build on.
