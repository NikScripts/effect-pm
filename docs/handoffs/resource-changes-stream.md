# Resource toolkit — the `changes` stream (note #2 design, for approval)

**Status:** designed, **not built** — one API fork needs your call, and a streaming
round-trip blocker needs investigation (below). This is note #2 from
`resource-toolkit-contract-notes.md` — the highest-leverage "live" primitive.

## Goal

Every resource handle exposes its whole observable state as a push source:
`changes: Stream<Snapshot>`. One-shot reads stay `Effect`s; `changes` is the live source
that makes dashboard atoms, CLI `--watch`, and a TUI all work from one contract. A
**snapshot** stream (whole state), not item enumeration (Effect queues can't enumerate).

## Mechanism (grounded in effect@4.0.0-beta.69)

Effect RPC supports streaming results: `Rpc.make(tag, { success: Snapshot, stream: true })`
→ the success type becomes `RpcSchema.Stream<Snapshot, E>`, the generated client method
returns `Stream.Stream<Snapshot, E>`, and the handler returns a `Stream`. So `changes` is a
**streaming rpc** in the contract group; the server backs it with a `SubscriptionRef`
(`ref.changes`) that the impl updates on state change (the "observed" pattern from
`project-observability-tap`).

## The fork (needs your call)

**(A) Opt-in spec entry via a third constructor** *(recommended)* — consistent with
`query`/`mutate`:

```ts
const Queue = Resource.tagFor("queue", {
  size: Resource.query(Schema.Number),
  changes: Resource.stream(QueueSnapshot),   // ← streaming read; service member: Stream<QueueSnapshot>
});
```

- Pros: consistent toolkit DX; opt-in (not every resource has a meaningful snapshot);
  `Snapshot` type is explicit; `changes` is just a conventionally-named streaming method.
- Cons: relies on the convention that the streaming member is named `changes`.

**(B) Built-in member via a factory option** — `changes` always present:

```ts
const Queue = Resource.tagFor("queue", spec, { snapshot: QueueSnapshot });
// handle always has `changes: Stream<QueueSnapshot>`
```

- Pros: literally "every handle exposes `changes`."
- Cons: special-cases one member outside the spec; awkward when a resource has no snapshot.

Recommendation: **A** — a `Resource.stream(success, opts?)` constructor (kind `query`, a
`stream: true` marker on `Method`). `changes` is then a normal streaming method. (B can be
added later as sugar over A if you want the guarantee.)

## What A touches (implementation plan)

- `Method` gains a `stream: boolean` marker; `Resource.stream(success, opts?)` sets it.
- `ServiceMethod<M>`: when `stream` → `Stream<Success, Error>` (property / `(p) => Stream`);
  otherwise `Effect` as today.
- `buildRpcGroup`: pass `stream: true` for streaming methods.
- `forwardClient`: a streaming method returns the client's stream call (already a `Stream`).
- `serverLayer`/`serveInstances`: handler returns the impl's `Stream` (no change beyond
  passing it through).
- Server impl pattern: hold a `SubscriptionRef<Snapshot>`; `changes = ref.changes`; update
  the ref wherever state changes.

## Blocker to resolve first

A minimal streaming round-trip over `RpcTest.makeClient` (no-serialization path) currently
throws `TypeError: Cannot read properties of undefined (reading '_tag')` — even for a plain
hand-written `Rpc.make("ticks", { success: Schema.Number, stream: true })` +
`Group.toLayer({ ticks: () => Stream.fromIterable([...]) })`. So the test harness for streams
needs investigation (likely a different client invocation, a required serialization layer,
or `RpcTest` streaming setup) before the slice can be verified end-to-end. Real transports
(http/socket) may differ from the in-memory test path.

## Snapshot shape (per resource)

The `Snapshot` schema is the whole observable state, e.g. a queue:
`{ sizes: { high, normal, low }, paused: boolean, completed: number }`. Must be encodable
(crosses RPC). Pretty-printing/branding for the snapshot fields ties into note #3
(schema-as-UX).
