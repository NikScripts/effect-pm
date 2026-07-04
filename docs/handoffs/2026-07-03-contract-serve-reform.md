# Contract + serve reform — decisions (locked)

Two connected reforms. Work from this doc; do not re-derive the locked shapes.

## Reform A — replace `value` with `ref`

**Why.** A `value` field exposes a plain, synchronous, live-mutated property (`p.count` is a `number` kept
current by a background fiber reassigning the field). Effect never mutates a service member in place — a
plain member is fixed at construction; changing state is a `Ref`/`SubscriptionRef` read through an effect.
So `value` is a non-idiomatic hack, and with `constant` (fixed-at-build) already covering the snapshot case,
`value` is redundant between `constant` (fixed) and a proper reactive ref.

**Locked decisions.**
- **Drop `value` entirely.** Field taxonomy becomes: `constant`, `ref` (new), `effect`, `stream`, `local`,
  `fleet`.
- **`Resource.ref(schema)`** → materializes as Effect's **`Subscribable<T>`** (`{ get: Effect<T>; changes:
  Stream<T> }`), uniform local and remote:
  - local: backed by a real `SubscriptionRef` (the impl provides + owns it; consumers only read/observe),
  - wire: `get` = RPC call, `changes` = RPC stream,
  - client: `Subscribable` reconstructed from those.
- **Remove `Resource.changes` / `Resource.ref` accessors** — superseded by `.changes` on `ref` fields; also
  stops treating `value` as a backdoor cell.
- **Delete the mirror machinery**: `bindValueToProp`, the block-for-initial (30s) wait, `valueRefsSym` /
  `withValueRefs`. This removes the whole eager-subscribe deadlock class.
- **Granularity is the author's choice**: one `ref` per independent field (default), or one `ref` over a
  `Schema.Struct` to batch co-changing fields into one stream / atomic snapshot.
- **Deferred (documented, not built): multiplexed path-keyed transport.** For resources with many nested
  refs, one subscription stream per resource carrying `{ path → value }` deltas + a snapshot frame,
  demuxed client-side into the per-ref `Subscribable`s. Pure transport optimization — no contract change,
  because the API is `Subscribable`. The wire protocol should leave room for path-keyed frames. Do NOT ship
  a public "one stream for all" surface (bakes transport into the contract).

## Reform B — serve-and-localize (one materialization)

**Why.** `serve` yields only RPC handler slots; `Resource.layer` grants `Self | LocalCapability` but serves
nothing. Providing both runs the impl twice → two ref/poller sets, two `peersLayer`s, drift between the
served view and the local view. A resource is **one instance**; serving is just exposing it outward.

**Locked decisions.**
- **`serverEntry` / `serveAllHttp` / `serveHttp` become local+served by default** — build the impl **once**,
  yield `HandlerContextOf<S> | Self | LocalCapability<S>`. The served cells *are* the local instance;
  `yield* Tag` in the serving process reads exactly what the dashboard/peers see. One `peersLayer`.
- **`Resource.remoteEntry(tag, impl)`** = served-only (no local grant), for pure gateways / edges. The
  low-level `serve` / `server` handler-layers stay the served-only primitives.
- Regression contract: the impl generator runs **once** (the report's "materialized twice" → once).

## Sequencing
A → B (A deletes machinery B would special-case). One branch per workstream, sliced commits, green at each
slice (typecheck + tests + Effect LSP), beta bump on merge. B may jump ahead only if wow is hard-blocked.

Source report for B: `docs/handoffs/2026-07-03-serve-and-localize-one-materialization.md`.
