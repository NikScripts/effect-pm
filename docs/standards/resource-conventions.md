{#resource-conventions title="Resource conventions" order=100 appliesTo=src}
# Resource conventions

How a resource — Process, Queue, RunResource, or a custom one — is defined and configured. The
`.Tag` class form itself is ruled in *Public types*; this chapter is about what goes where, and how
behaviour is added.

{#tag-is-contract-layer-is-runtime .must appliesTo=src}
## The tag is the contract; the layer is the runtime

A resource splits cleanly in two. The **tag** carries the wire contract — the `payload` / `success` /
`error` schemas — and nothing else; it is the wire SSOT and the thing a client (even a browser)
imports. The **layer** carries the runtime — the `effect` worker, `polling`, `autoStart`. Never cross
them: schemas never move into layer config (that breaks the wire SSOT and RPC safety), and the worker
never moves onto the tag (that drags the engine into the light contract).

``` ts
// contract — on the tag
class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", { payload: Job }) {}

// runtime — in the layer
QueueResource.layer(Mail, { effect: handleJob, autoStart: true })
```

``` ts
// ❌ bad — wire schema in the layer (no longer SSOT; client and server can disagree)
QueueResource.layer(Mail, { payload: Job, effect: handleJob })
```

{#behaviour-via-piped-combinators .must appliesTo=src}
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

{#polling-vs-schedule .must appliesTo=src}
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

{#default-queue-lean .must appliesTo=src}
## The default queue stays lean; custom lanes are a separate type

The default `QueueResource` is exactly three lanes — high / normal / low — and stays that way. When
you need a different lane count or a weighted take, that is `CustomQueueResource`, a **separate
type**, not a wider-shaped default queue. Its scheduling code is loaded only when selected (see
*Build & browser safety*), so the default queue never carries the weight of lane machinery it doesn't
use.

``` ts
// default — three fixed lanes
class Mail extends QueueResource.Tag<Mail>()("@acme/Mail", { payload: Job }) {}

// custom — N named lanes, a distinct type
class Jobs extends CustomQueueResource.Tag<Jobs>()("@acme/Jobs", { payload: Job }) {}
CustomQueueResource.layer(Jobs, {
  levelCount: 4,
  namedLevels: { interactive: 0, standard: 2, batch: 3 },
  takeAlgorithm: "weighted",
})
```

{.note}
Two related facts live elsewhere: the `.Tag` class-extends form → *Public types*; durability is
presence-driven (`serviceOption`) → *Storage*.
