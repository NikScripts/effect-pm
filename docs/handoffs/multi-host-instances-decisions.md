# Decisions: one resource, N host-local instances (multi-host)

**Status:** design **locked** except the Open Questions at the end. Not yet built. This is the SSOT —
build from this, don't regenerate shapes from chat. Input/exploration: `multi-host-instances.md`
(wow-sports). Consumer plan: `apps/services-hub/docs/MONITORABLE-RESOURCES-PLAN.md`.

## The need
One resource **shape** (e.g. `Database`) that exists as **N instances of that one shape**, one per host
serve (`Database` on `NwslHost` / `EbwslHost` / `WnbaHost`): same spec + readiness, **independent state +
readiness**, each **served locally on its own host**. The consumer holds **one class**, never N. The
count is incidental (leagues today; `main`+`cms` tomorrow). It is "one resource, N instances," not "N
resources."

## Locked decisions

1. **Groups only organize.** A multi-host resource is **one tag = one group node**. The group expresses
   *position in the nav tree*, never hosting or instance count. The same tag **may** appear at multiple
   group positions — that's a **cross-link** (one identity, multiple nav paths; a symlink, not a copy)
   and is allowed, but it is **not** the instance mechanism. Instance multiplicity is a **runtime fact**
   (which hosts serve it), never encoded in the group tree.

2. **Everything to use a service lives in the tag — and the `Host` carries its own URL.** A tag is
   self-sufficient. `Resource.Host<H>("id", { url })` carries the address, so the host has everything
   needed to connect to it; a multi-host tag names its host *set* (`multiHost(NwslHost, …)`), so the
   tag transitively holds the host set **and** each host's URL — fully self-contained, no URLs passed
   anywhere. (Also tightens the single-host case: `connect`/`client` read the URL off the host instead
   of a separate `connectHttp(host, { url })` arg.) The URL is sourced however you like *at host
   definition* — a literal, `process.env`, or Config — it just ends up on the host. Host on the tag is
   not mandatory: a host-relative tag (no `multiHost`) supplies hosts at the layer (mode 1).

3. **Three connection/availability modes (have it both ways):**
   - **(1) No hosts in the tag** — hosts supplied at the layer. Combined fields resolve **only where the
     layer knows the hosts** (the dashboard / a node aggregator). No peer mesh. ("Original plan.")
   - **(2) Hosts in the tag** — the tag carries the host set (addresses) → **self-contained**; combined
     fields work from **any** client, anywhere.
   - **(3) Layer helper** — pass the hosts when building the serve/client layer → combined wherever that
     layer is.
   - **(4) Elected host** — *Open* (see below); reduces the mesh.

4. **A server layer per host** — each host runs `Resource.serverEntry(Database, impl)` on its own
   `serveAllHttp` (its own `RpcServer`). **Not** "one serves, the rest client."

5. **No instance suffix/key for the multi-host case.** Each host is a separate RPC server over a
   separate transport, so every host serves the resource under the **same** wire key — the **host
   (transport) is the discriminator**, no prefix/suffix. The instance **key/suffix is reserved** for
   **same-host multiplicity** (>1 instance on one host) — a separate, deferred mechanism.

6. **Multi fields are *derived*, combined **locally where they're called** — no host-side gather, no
   mesh.** Calling a multi field is an `Effect.all` across the host instances (gather each host's
   per-instance method, complete when all respond, fold in-process) — it runs in **whoever holds the
   tag** (the dashboard, an aggregator, another service), with no intermediary and no host serving a
   combined RPC. (The freeform fold output isn't a wire `Schema`, so it *can't* be an RPC a host serves;
   the gathered per-instance values are schema'd, the fold is local. This supersedes an earlier
   "combine runs server-side on the host you call" take.) Modes are just where the host set comes from
   (tag vs layer); the combine is always local to the holder.

7. **Peers are a keyed set, never `client(tag)` × N.** Providing the same tag N times into one Context
   is a last-write-wins collision. So the host set supplies a **`host → client` keyed map** (the full
   per-host client), and the multi fields iterate that — slice-1 `combineQuery`/`combineStream`. The
   selector gets the **full** per-host client, so a fold can read any/several fields.

8. **Multi fields are a piped contract extension (`Resource.multi`), combine pipes onto the field.**
   A single object literal can't type-safely reference its own siblings (TS infers the literal as a
   whole — `(self) => self.x` degrades `self.x` to the constraint type; verified). The base contract
   must be typed *before* the multi fields reference it. So `Resource.contract({…})` is a **pipeable**
   contract, and `Resource.multi((c) => …)` is a **data-last combinator** (typed like `Effect.flatMap`):
   because the base is already typed when the pipe applies, `c` is **precise** (verified — wrong field
   name / kind is a compile error). It's a pipeline, so other contract-level features pipe on the same
   way — `multi` is just the first.

   ```ts
   const databaseSpec = Resource.contract({
     connections: Resource.query(Schema.Number),
     status:      Resource.query(DbStatus),
     metrics:     Resource.stream(Metric),
   }).pipe(
     Resource.multi((m) => ({
       //          ↑ m = the multi builder, typed against the contract (precise)
       totalConnections: m.query((host) => host.connections, Combine.sum),
       fleetMetrics:     m.stream((host) => host.metrics, Combine.mergeStreams),
       // the possibilities — the full per-host client, fold over any/several fields:
       fleetHealth:      m.query((host) => Effect.all({ conn: host.connections, st: host.status }), summarizeHealth),
     })),
     // future contract features pipe on here too
   );

   class Database extends Resource.Tag<Database>()("app/Database", databaseSpec).pipe(
     Resource.withReadiness(databaseReadiness),
     Resource.multiHost(NwslHost, EbwslHost, WnbaHost),
   ) {}
   ```

   - **The selector gets the full per-host client** (`host: ServiceOf<S>`), not a single picked field —
     so a multi field can fold over any/several fields, derive, or call across them. `m.query(sel, fold)`
     is exactly slice-1 `combineQuery(peerMap, sel, fold)`; `m.stream(sel, transform)` is `combineStream`.
   - **Kind is glanceable** (it's an *extension* of the core contract): multi fields live in the
     `Resource.multi((m) => …)` block (visually separate from `contract({…})`) **and** use `m.query` /
     `m.stream` — distinct from the core `Resource.query` / `Resource.stream`. (Name the builder what
     reads best — `m` / `fleet` / `across`.) This replaces the `c.field.pipe(Resource.combine(…))` form,
     which buried the kind and only saw one field.
   - Combined fields sit **directly on the service under their own names**, beside the per-instance
     fields: `svc.connections` (this host) and `svc.totalConnections` (fleet). One class, both reads.
   - `Tag` consumes the resulting spec unchanged; `.pipe(withReadiness(...))` / `.pipe(multiHost(...))`
     still compose. Plain (non-multi) resources keep the object-literal spec — `Resource.contract` +
     `Resource.multi` is **opt-in**.
   - Why precise here but the tag's data-last `withReadiness` widens `Self`: the base contract is a
     normal value (type known at pipe time), whereas a tag piped in a class `extends` position is its
     own still-being-declared type (self-recursive) so must widen.

9. **Per-host attribution + dev-controlled failure.** The fold/transform receives the per-host
   **outcomes**, so a down peer is the **dev's** call — sum the survivors, fail hard, or report "2/3
   reporting." The toolkit imposes no policy; built-in combines (`sum`, etc.) skip down hosts.
   **Locked outcome type:** a query combine receives `ReadonlyArray<HostResult<A, E>>` where
   `HostResult = { host: string; exit: Exit<A, E> }` (Effect-native success/failure, host-attributed);
   a stream combine receives `ReadonlyArray<{ host: string; stream: Stream<A, E> }>`. `Combine.*`
   helpers operate on the successes; a custom fold sees the full array (failures included).

10. **Tools, not widgets, for custom resources.** A custom resource's shape is unknown, so the toolkit
    can't render its widget (same reason generic introspection UI was rejected). It ships **tools** —
    discover instances, per-host facets, the combined service, the combine primitives — and the consumer
    assembles their own widget. Per-host **readiness** is already generic (the health board shows each
    host facet without knowing the shape).

11. **The combine machinery is isomorphic (browser + node/bun).** It lives in the **browser-safe core**,
    so a dashboard, a node/bun aggregator, and a CLI all use the same combine — always local to the
    holder (decision 6), regardless of mode.

12. **The host set is piped on the tag, variadic** (like `withReadiness`). The combine *fields* live in
    the contract (decision 8); the **host set** (mode 2) is `.pipe(Resource.multiHost(NwslHost,
    EbwslHost, WnbaHost))` — variadic, the hosts carry their own URLs (decision 2) — or omitted (mode 1).

## How it works (mechanism)
- **Serve:** each host's process runs the same `serverEntry(Database, impl)` — its own local instance.
  Nothing host-specific is passed (no URL, no host list). Hosts **don't** connect to each other — no
  mesh. So there's **no `serveAcrossHosts({host, url, impl}[])` helper** either.
- **Combine (always local to the holder):** the holder (dashboard / aggregator / any service using the
  tag) builds a **keyed map of clients** — one per-host client of THIS resource — from the tag's
  `multiHost` set + each host's URL. `m.query((host) => host.connections, fold)` = `Effect.all` over
  that map (each host answers its **plain** per-instance method, fully typed/schema'd), then fold the
  per-host results **in-process**. Same in browser, node, CLI. Mode 1 (host set at the layer) and
  mode 2 (host set on the tag) differ only in **where the host set comes from** — the combine itself is
  identical and local.
- **Readiness** stays per-host and local (each host's `/health`); any cross-host rollup is a
  combine/holder concern, not `/health`.

## Open questions (resolve in the build slice)
- **`multiStream` lifecycle** — the holder opens N live per-host subscriptions and merges/transforms
  them; teardown + a host dropping/reconnecting. [slice 2]
- **Same-host multiplicity** — the reserved instance-key mechanism (decision 5), if/when needed. [later]
- **Scale (formerly "elected host", mode 4)** — *lower priority now*: with the derived/local model
  there's **no mesh** (the holder opens N client connections, linear in hosts). If a holder ever
  shouldn't fan out to every host, the fallback is **push-to-redis** (each host publishes its own
  values; the holder reads the aggregate from the store). Deferred; not needed at league scale.

(Resolved since v1: combine is local to the holder, no mesh / no host-side gather → decision 6;
per-host outcome type → decision 9; contract shape → decision 8 piped form; host/URL/topology →
decision 2 the `Host` carries its URL.)

## Build slices
1. **Combine core (this slice).** The isomorphic primitive: gather a field across a **caller-supplied**
   keyed peer map, capturing each host's outcome, + the `Combine` strategies + `HostResult`. Pure
   (no Spec surgery, no wiring), browser + node, fully unit-tested. Usable today by a node aggregator.
   `src/MultiHost.ts`, exported `@nikscripts/effect-pm/MultiHost`.
2. **Contract pipeline + wiring.** `Resource.contract({...}).pipe(Resource.multi((c) => ({...})))` with
   `m.query((host) => host.field, fold)` / `m.stream(...)` (full per-host client); `Host` carries its URL + `multiHost(...)` on the tag;
   multi-field impls call the slice-1 combine over a keyed peer map built from the tag; serve-per-host
   (`serverEntry`); modes 1–3. (`multiStream` lifecycle resolved here.)
3. **Dashboard tools.** Expand a hostless leaf into per-host facets + the combined service; discovery
   via `hostsOf` + `HostStatus`.
4. **Elected host (mode 4).** Static aggregator first; redis-push as the scale option.

## Builds on (already shipped)
- `Resource.serverEntry` (record + Effect forms) — the per-host serve primitive (beta.15).
- Host-scoped key scheme (from `ApiMetrics`) — available if a key is ever needed.
- Readiness — `withReadiness` / `readinessOf` / `allReady`, per-host `/health` + `HostStatus`.
- Host discovery — `hostsOf` + `HostStatus.resources` (the dashboard already streams these).

## Divergence from the exploration (`multi-host-instances.md`)
The exploration leaned toward **unifying** the instance family into one host-aware keyed primitive
(its "direction D"). We **diverged**: keep the axes **separate** — host-relative tags + server-side
`multiQuery`/`multiStream` gather for *cross-host*; reserve the keyed-instance mechanism for *same-host*
multiplicity. Cleaner (each mechanism does one thing), and it adds the typed `contract().multi()`
helper + combined-fields-on-the-service, which the exploration didn't have.
