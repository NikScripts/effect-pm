{#resources title="Resource Factories" order=60 appliesTo=src}
# Resource Factories

How a resource is defined, served, and meshed across nodes. Covers the tag/layer split, the serve vocabulary, and multi-node meshing.

{#tag-is-contract-layer-is-runtime .must appliesTo="src examples"}
## The tag is the contract; the layer is the runtime

A resource splits cleanly in two. The **tag** carries the wire contract — the `payload` / `success` /
`error` schemas — and nothing else; it is the wire SSOT and the thing a client (even a browser)
imports. The **layer** carries the runtime — the `effect` worker, `polling`, `autoStart`. Never cross
them: schemas never move into layer config (that breaks the wire SSOT and RPC safety), and the worker
never moves onto the tag (that drags the engine into the light contract).

``` ts
// contract — the wire schema, passed positionally
class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", Job) {}

// runtime — in the layer
QueueResource.layer(Mail, { effect: handleJob, autoStart: true })
```

``` ts
// ❌ bad — wire schema in the layer (no longer SSOT; client and server can disagree)
QueueResource.layer(Mail, { payload: Job, effect: handleJob })
```

{#positional-schema-args .must appliesTo="src examples"}
## Pass tag schemas positionally when you can

When a tag needs only its wire schema, pass it **positionally** — it's the clearest form. Reach for
the `{ payload, success, error }` config object only when the tag carries more than one wire slot, or
extra configuration. `CustomQueueResource` always takes the object, because its lane structure
(`levelCount`, `namedLevels`) lives on the tag alongside the payload.

``` ts
// ✅ single schema → positional
class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", Job) {}

// config object — more than one wire slot
class Ingest extends Process.Tag<Ingest>()("app/Ingest", { success: Report, error: PullFailed }) {}

// CQR — always the object; lane config rides on the tag
class Jobs extends CustomQueueResource.Tag<Jobs>()("@acme/Jobs", {
  payload: Job,
  levelCount: 4,
  namedLevels: { interactive: 0, standard: 2, batch: 3 },
}) {}
```

{#behaviour-via-piped-combinators .must appliesTo="src examples"}
## Compose behaviour with piped combinators, not constructor flags

Optional behaviour — scheduling, readiness, distribution — is **piped onto** the resource, never
passed as a constructor flag. Each combinator is composable and independent, so the base stays small
and you add only what you need (this is *Principles → Don't fight the framework* in the concrete).

``` ts
// base tag runs immediately; add behaviour by piping
class Ingest extends Process.Tag<Ingest>()("app/Ingest", { success: Report })
  .pipe(
    Process.schedule([Process.window(openAt, closeAt)]),  // when it may run
    Resource.withReadiness(isWarm),                        // when it counts as ready
  ) {}
```

{#data-last-tag-duals-shallow .must appliesTo=src}
## Data-last tag duals must not constrain `Svc`-bearing tag unions

A combinator meant for `class X extends Tag<X>()(…).pipe(combinator(…))` must not constrain its
data-last `T` as `ResourceTag | NodeBoundTag`. Those types carry a default `Svc = ServiceOf<S, Self>`;
stock tsc expands that while `Self` is still being declared and hits **TS2589** (tsgo often stays
quiet — gate with **both**). Constrain `T` with a shallow brand that only needs the spec (the package
uses `PipeableTag = { readonly [specSym]: FlatSpec }` for `withReadiness` / `distributed`). `T` is
still inferred as the concrete tag, so `(tag: T) => T` preserves it.

``` ts
// ✅ shallow — PipeableTag / equivalent
<T extends PipeableTag>(…): (tag: T) => T

// ❌ deep — reopens TS2589 on node-bound class .pipe under stock tsc
<T extends ResourceTag<any, any, any> | NodeBoundTag<any, any, any, any>>(…): (tag: T) => T
```

{#polling-vs-schedule .must appliesTo="src examples"}
## Polling and schedule are different questions — never conflate

Two independent axes govern a running Process:

- **The schedule** answers *whether* an instance should be running at all — it arms and disarms.
- **Polling** answers *how often* an already-armed instance repeats its tick.

A base `Process.Tag` is always armed and runs immediately; `.pipe(Process.schedule([...]))` gates it
to windows, and seeding `Process.schedule([])` starts it disarmed. Polling (`Polling.spaced`, …) is
set separately in the layer. Don't reach for one to do the other's job.

``` ts
Process.layer(Ingest, {
  effect: pull,
  polling: Polling.spaced(Duration.seconds(30)),  // cadence — not "should it run"
})
```

{#default-queue-lean .must appliesTo="src examples"}
## The default queue stays lean; custom lanes are a separate type

The default `QueueResource` is exactly three lanes — high / normal / low — and stays that way. When
you need a different lane count or a weighted take, that is `CustomQueueResource`, a **separate
type**, not a wider-shaped default queue. Its scheduling code is loaded only when selected (see
*Build & browser safety*), so the default queue never carries the weight of lane machinery it doesn't
use.

``` ts
// default — three fixed lanes; schema positional
class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", Job) {}

// custom — N named lanes, a distinct type; lane config forces the object form
class Jobs extends CustomQueueResource.Tag<Jobs>()("@acme/Jobs", {
  payload: Job,
  levelCount: 4,
  namedLevels: { interactive: 0, standard: 2, batch: 3 },
}) {}
```

{.note}
Two related facts live elsewhere: the `.Tag` class-extends form → *Public types*; durability is
presence-driven (`serviceOption`) → *Storage*.


{#same-code-local-or-remote .must appliesTo="src examples"}
## The same code runs local or remote

A resource is driven by the same `yield* Tag` whether it is in-process or served over RPC — only the
layer you provide differs. Never branch on local-vs-remote in a consumer. A field either behaves
identically in both, or its divergence surfaces as a type or dependency error — never a silent
same-looking-but-different (see *Principles → Fail loudly*).

{#serve-vocabulary .must appliesTo="src examples"}
## Use the locked serve vocabulary

Four verbs, one axis — how a resource is made available:

- **`layer`** — local only.
- **`serve`** — local **and** served over RPC (the default for a node).
- **`serveRemote`** — served only, not runnable in-process.
- **`client`** — a remote handle to a served resource.

Transport is a **separate** line: `httpServer` / `httpClient` / `connect`. `Http` appears **only**
there — the core verbs stay transport-agnostic, so the same resource can be served over any protocol.

{#serve-through-spec-checked-forms .must appliesTo="src examples"}
## Serve through the engine's spec-checked form, never a bare literal

Serve a resource through its engine form (`QueueResource.serve`, `Process.serve`) — these mount the
handlers **and** keep the worker or tick alive. `Resource.serve` only mounts handlers; using it for a
queue leaves the worker dead. Never hand-write a `{ tag, impl }` literal: it types as
`Record<string, unknown>` and silently swallows typos — the engine form spec-checks the impl against
the tag.

{#provide-merge-serve-layers .must appliesTo="src examples"}
## `provideMerge` serve layers onto `httpServer`, never `provide`

`httpServer([...serveLayers])` unions each layer's requirement `R`, like `Layer.mergeAll`. Compose
with `Layer.provideMerge` so the serve layers stay in context; a bare `Layer.provide` prunes them,
because `httpServer`'s own type doesn't demand them.

``` ts
// ✅ good — serve layers preserved
const live = Resource.httpServer([
  Resource.serve(Counter, counterImpl),
  Resource.serve(Mail, mailImpl),
])

// ❌ bad — provide prunes the serve layers off the server
program.pipe(Layer.provide(Resource.serve(Counter, counterImpl)))
```

{#declare-dont-provide-in-workers .must appliesTo="src examples"}
## Declare dependencies in the worker; provide at the serve boundary

A worker or tick body **declares** its dependencies with `yield* Tag` — it never `Effect.provide`s
them inline. Provide **whole-resource** deps once, at the serve/layer boundary, so
`strictEffectProvide` stays clean and the same body works local or served. Do **not** hoist a
**sub-effect-scoped** dep to `serve` — that widens `R` for the whole body; keep an app-local
scoping combinator beside the handler service — do not look for a package `locally` helper.

{#one-instance-one-materialization .must appliesTo="src examples"}
## One instance, one materialization

A resource is a single instance. Its local use and its served handlers share **one** materialization
— serving must not re-run the impl generator. Compose extra behaviour as post-construction
combinators (`withReadiness`, `distributed`) piped onto the resource, not as re-materializations or
baked constructor options (see *Principles → Don't fight the framework*).


{#one-resource-n-instances .must appliesTo="src examples"}
## One resource = N node-local instances

One class. Each node runs its own instance; `peers` gives you the per-node handles.

``` ts
// one tag — not one-per-node
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job) {}

const perNode = yield* Resource.peers(Prices)
// { "node-a": handle, "node-b": handle, … } — keyed by node
```

{#readiness-per-node-local .must appliesTo="src examples"}
## Readiness is per-node and local — never a cross-node hop

Readiness derives from a resource's **own** status and rolls up into that node's `/health`. Reaching
into a peer to decide your own readiness cascades one node's failure into its neighbours.

``` ts
// ✅ derived from this instance's own status
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job)
  .pipe(Resource.withReadiness((svc) =>
    Effect.map(svc.status.get, (s) => s.phase === "running"),
  )) {}

// ❌ readiness that hops to peers — a down neighbour drags this node down
Resource.withReadiness(() => Effect.map(Resource.peers(Prices), allReady))
```

For a **stadium-board** view of the pack (Reachable / Unreachable), use
[`FleetHealth`](../guides/fleet-health.md) — a separate glass; do not stuff the fold into
`withReadiness`.

{#fold-over-leaf-fields .must appliesTo="src examples"}
## Fold over leaf fields; fleet views stay out of the fan-out

`peers` fans out to leaf handles. A `fleet`-marked field is *already* a combined view, so it's
excluded from the fan-out — folding over it would re-aggregate an aggregate. Fold leaves, and add
your own node explicitly.

``` ts
// a combined field is marked fleet → not re-fanned-out by peers
class Prices extends QueueResource.Tag<Prices>()("app/Prices", Job) {
  static readonly totalDepth = Resource.fleet(Resource.effect(Schema.Number))
}

// fold over leaves, self included explicitly (never silently)
const depthByNode = { ...(yield* Resource.peers(Prices)), [self.key]: local }
```

{#peers-are-lazy .must appliesTo="src examples"}
## Peers are lazy and degrade to a partial mesh

`peersLayer` never connects eagerly. No url ⇒ skip that peer, never throw. Urls come from the node or
`Config` — never frozen into the contract.

``` ts
Resource.peersLayer(Prices, self, {
  nodes,
  url: (node) => Config.option(Config.string(`${node.key}_URL`)),
  //   Config.option → undefined skips a peer (partial mesh)
  //   a raw ConfigError fails the build loudly (misconfiguration)
})
```
