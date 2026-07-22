---
"hyperlink-ts": minor
---

**Replace `value` fields with `ref` (a `Subscribable`).** A `value` was a plain property kept "live" by a
background fiber mutating the service object in place — which Effect never does (a plain member is fixed at
construction; changing state is a `Ref` read through an effect). With `constant` already covering the
fixed-at-build case, `value` was a non-idiomatic hack between the two.

- **Dropped `value`.** Field kinds are now `constant` / `ref` / `effect` / `stream` / `local` / `fleet`.
- **New `Resource.ref(schema)`** → materializes as **`Subscribable<A>`** (`{ get: Effect<A>; changes:
  Stream<A> }`), uniform local and remote: `yield* svc.x.get` for the current value, `svc.x.changes` to
  observe. The impl owns a `SubscriptionRef`, provided via **`Resource.subscribable(ref)`** (or
  **`Resource.mapSubscribable(source, f)`** to derive one — e.g. a queue's `size` from its `status`).
- **Removed `Resource.changes` / `Resource.ref` accessors** — `ref` fields expose `.changes` natively.
- **Deleted the mirror machinery** (`bindValueToProp`, the 30s block-for-initial and its deadlock class).

**Migration:** `Resource.value(S)` → `Resource.ref(S)`; the impl gives a `Subscribable` (`subscribable(ref)`
or `mapSubscribable`) instead of a raw `Stream`; reads become `yield* svc.x.get` (was `svc.x`) and
`svc.x.changes` (was `Resource.changes(svc, s => s.x)`). Queue `size`/`status`/`isEmpty` are now `ref`s.

**Serve-family vocabulary (breaking).** Modes are now protocol-neutral and uniform across `Resource` and
every contract namespace (`QueueResource`, `CustomQueueResource`, `Process`, `ApiMetrics`,
`Telemetry`):

- **`layer(tag, impl)`** — local only (grants `Self | LocalCapability<Self>`).
- **`serve(tag, impl)`** — local **and** served, the default. Builds the impl **once** and grants
  `Self | LocalCapability<Self>` alongside the wire handlers, so a co-located node serves its resources
  **and** `yield*`s them (read a `local` member, share a `ref` cell) with no double materialization and no
  second `peersLayer`.
- **`serveRemote(tag, impl)`** — served only (a pure gateway/edge; no local grant).
- **`client(node)`** — remote.

**Transport bundlers:** **`httpServer([...serve-layers], opts)`** exposes one or more `serve`/`serveRemote`
layers on a single http `RpcServer` (and auto-serves the reserved node-status resource, so it fully replaces
the old all-in-one entry point); **`httpClient(node)`** wires a node's transport from a `url`; generic
**`connect`** covers custom protocols.

**Removed** the transitional names: `server`, `serverEntry`, `remoteEntry`, `serveHttp`, `serveAllHttp`, and
the `ServeEntry` `{ tag, impl }` shape. Migrate `serverEntry`→`serve`, `remoteEntry`→`serveRemote`,
`serveHttp(X, i, opts?)`→`httpServer([serve(X, i)], opts)`, and
`serveAllHttp([...])`→`httpServer([...serve-layers])`.
