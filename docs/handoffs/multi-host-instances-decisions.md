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

2. **Everything to use a service lives in the tag.** A tag is self-sufficient. So a multi-host tag
   **may carry its host set (addresses)** — that's the self-contained mode. The host is **not**
   mandatory on the tag; it can also be supplied at the layer. (This supersedes an earlier wrong take
   that the host must come off the tag — both are valid; see the modes.)

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

6. **Combine runs server-side, locally on whatever host you call** (modes 2/3). The `multiQuery` /
   `multiStream` fields, invoked on any host, gather from **self + peers** and combine. The consumer
   points a client at **any** host and reads the fleet value; the dashboard gets it with one call to one
   host. (Mode 1: the combine runs client-side in the dashboard/aggregator, which holds all the hosts.)

7. **Peers are a keyed set, never `client(tag)` × N.** Providing the same tag N times into one Context
   is a last-write-wins collision. So the host set / layer helper supplies a **`host → client` keyed
   map**, and the multi fields iterate that. This is the primitive the multi fields read.

8. **`multiQuery` / `multiStream` are contract field kinds, defined via a type-safe two-phase helper.**
   An object literal can't reference its own siblings, so the contract is built in two phases — per
   instance fields first, then multi fields against a **typed** handle:

   ```ts
   const databaseSpec = Resource.contract({
     connections: Resource.query(Schema.Number),
     status:      Resource.query(DbStatus),
     metrics:     Resource.stream(Metric),
   }).multi((c) => ({
     //          ↑ c = the typed per-instance contract (local-only fields excluded)
     totalConnections: Resource.multiQuery(c.connections, Combine.sum),
     fleetStatus:      Resource.multiQuery(c.status, mergeStatus),
     fleetMetrics:     Resource.multiStream(c.metrics, mergeMetrics),
   }));

   class Database extends Resource.Tag<Database>()("app/Database", databaseSpec).pipe(
     Resource.withReadiness(databaseReadiness),
   ) {}
   ```

   - The picked field is the **actual method** (`c.connections`), type-checked — not a string. Wrong
     name, wrong kind (e.g. a stream into `multiQuery`), or a local-only field → compile error.
   - Combined fields sit **directly on the service under their own names**, beside the per-instance
     fields: `svc.connections` (this host) and `svc.totalConnections` (fleet). One class, both reads.
   - Returns the merged spec; `Tag` consumes it unchanged, `.pipe(withReadiness(...))` still composes.
   - Plain (non-multi) resources keep the object-literal spec — `.contract().multi()` is **opt-in**.

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

11. **The combine machinery is isomorphic (browser + node/bun).** It lives in the **browser-safe core**
    (`/Resource`), so a dashboard, a node/bun aggregator, and a CLI all use the same combine. Mode-1
    (client-side) and modes 2/3 (server-side) reuse the same fold/merge logic.

12. **Multi-host config is piped on the tag** (like `withReadiness`). The combine *fields* live in the
    contract (decision 8); the **host set** (mode 2) is piped on the tag — e.g.
    `.pipe(Resource.multiHost({ hosts }))` — or omitted (mode 1). Exact marker name/shape is Open, but
    it pipes, consistent with everything else.

## How it works (mechanism)
- **Serve:** each host's `serveAllHttp` includes `serverEntry(Database, impl)` — its own local instance.
- **Mesh (modes 2/3):** a layer helper (or the tag's host set) wires each host with a **keyed map of
  clients to its non-self peers**. `multiQuery(c.connections)` on host A = gather `A.local.connections`
  + each peer client's `.connections` (peers answer the **plain** per-instance query — no recursion) →
  fold over the per-host record.
- **No mesh (mode 1):** the dashboard/aggregator holds all the hosts and does the same fold client-side.
- **Readiness** stays per-host and local (each host's `/health`); any cross-host rollup is a
  dashboard/combine concern, not `/health`.

## Open questions (resolve in the build slice)
- **Elected host (mode 4)** — three shapes, cheapest first: **(a) statically-designated aggregator**
  (one host meshes to peers + serves the multi fields; single point); **(b) any-entry, forward-to-
  elected** (every host exposes the field but forwards to the one gatherer); **(c) push to a shared
  store** (each host publishes its own values to redis; combined = read all from the store — connections
  go **linear**, no mesh, survives a down host; needs the store). Recommendation: ship (a) for the
  simple win, keep (c) as the scale story. Needs a call.
- **`multiStream` lifecycle** — N live peer subscriptions managed on the serving host (merge/transform,
  teardown, a peer dropping/reconnecting). [slice 2]
- **`multiQuery` scope** — pick exactly one per-instance field (locked default), or allow folding over
  several at once? [slice 2]
- **Topology source for mode 3** — the fleet map `[{ host, url }]` the layer helper needs. [slice 2]
- **Same-host multiplicity** — the reserved instance-key mechanism (decision 5), if/when needed. [later]

## Build slices
1. **Combine core (this slice).** The isomorphic primitive: gather a field across a **caller-supplied**
   keyed peer map, capturing each host's outcome, + the `Combine` strategies + `HostResult`. Pure
   (no Spec surgery, no wiring), browser + node, fully unit-tested. Usable today by a node aggregator.
   `src/MultiHost.ts`, exported `@nikscripts/effect-pm/MultiHost`.
2. **Contract field-kinds + wiring.** `Resource.contract({...}).multi((c) => ({...}))`, `multiQuery` /
   `multiStream` as spec fields whose impls call the slice-1 combine; the keyed peer map from a layer
   helper / in-tag host set; serve-per-host; modes 1–3; the mode-3 topology map. (`multiStream`
   lifecycle resolved here.)
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
