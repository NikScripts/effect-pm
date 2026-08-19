{#agent-06-service-make-address title="Agent 6 — .Service / .make split + Address-as-requirement" status="draft" appliesTo=src}
# Agent 6 — `.Service` / `.make` split + Address-as-requirement

**Owner game plan, captured 2026-08-17. Nothing here is Eng'd.**
Owner gate: **do not implement the Address requirement work without the owner.**

## 0. Formatting rule — binding on everything in this doc

**Break every call onto its own line.** Chains, nested constructors, and multi-key option
bags. No exceptions, in this doc or in chat.

``` ts
// bad
.add(Hyperlink.group("admin").add(reset))
```

``` ts
// good
.add(
  Hyperlink.group("admin")
    .add(reset)
)
```

Standard: [`docs/standards/documentation.md`](../standards/documentation.md)
(*Break every call onto its own line*).

## 1. Two constructors, one contract

`.Service` **stays as is** — the class handle, yieldable. Its constructor may gain changes;
the class handle itself does not change.

`.make` is (re)introduced, following HttpApi / HttpApiClient "kinda". It returns a class or
value — not a service.

| Constructor | Result | Yieldable | Layer builder | Client helpers |
|-------------|--------|-----------|---------------|----------------|
| `.Service`  | service (Context identity) | **yes** | yes | yes |
| `.make`     | class / value (no identity) | no | yes | yes |

**Interchangeability is the requirement.** The same methods and helpers accept both. The service
class carries the same pieces the non-service class carries, so it goes to the layer builder *and*
to the client helpers. The only real difference: **you can only yield one of them.**

### 1.1 Four cells — const and class, for both (2026-08-18)

Both constructors support both forms, as HttpApi does. `<Self>` appears only in the class form.

```ts
// ── .make — contract, no identity ──────────────────────────────
const jobs = WorkPool.make("jobs")
  .payload(job)

class Jobs extends WorkPool.make("jobs")
  .payload(job)
{}

// ── .Service — contract + identity, yieldable ──────────────────
class Jobs extends WorkPool.Service<Jobs>()("app/Jobs")
  .payload(job)
{}

const jobs = WorkPool.Service()("app/Jobs")
  .payload(job)
```

Precedent — `Context.Service` already carries exactly this two-overload split:

```ts
// repos/effect/packages/effect/src/Context.ts:200
export const Service: {
  <Identifier, Shape = Identifier>(key: string): Service<Identifier, Shape>                // const form
  <Self, Shape>(): <const Identifier extends string, …>(id, options?) => ServiceClass<…>   // class form
}
```

What each cell buys:

| Cell | Identity | `Self` brand | Yieldable | Name |
|------|----------|--------------|-----------|------|
| `const x = make(id)` | no | no | no | no |
| `class X extends make(id)` | no | no | no | yes |
| `const x = Service()(id)` | yes | **no** | yes | no |
| `class X extends Service<X>()(id)` | yes | yes | yes | yes |

### 1.2 `Service()` without `Self` — possible, not encouraged (owner, 2026-08-18)

**Decision: keep the cell.** Same stance Effect takes on its own const overload. Allowing it
enables **dynamic generation of services**, which is a real need here — per-tenant, per-shard,
per-discovered-node pools:

```ts
const jobsFor = (tenant: string) =>
  WorkPool.Service()(`app/Jobs/${tenant}`)
    .payload(job)
```

**What degrades:** everything branded by `Self`.

```ts
class Jobs extends WorkPool.Service<Jobs>()("app/Jobs")
  .payload(job)
{}
// Local<Jobs>, PeersId<Jobs>, SelfNodeId<Jobs> — branded

const jobs = WorkPool.Service()("app/Jobs")
  .payload(job)
// no Self → local gating, peers, selfNode lose their brand
```

Two dynamically minted services also share a type, so TS cannot tell them apart. Usually fine —
you are keying by runtime value anyway — but the compiler stops helping.

**Hazard to document,** in Effect's own words about the same overload:

> The string key is the runtime identity of the service. Reusing the same key string for unrelated
> services makes them occupy the same slot in a `Context`.

With a computed key that is easy to hit by accident.

### 1.3 Open on this shape

1. Does `class X extends WorkPool.make(id)` earn its keep? It gives a name but no identity, so
   `yield* X` is a type error — and at the declaration site it looks identical to a `.Service`
   class while behaving differently at the use site. HttpApi has the same cell and it is fine
   there because nobody expects to yield an `HttpApi`.
2. Chain (`.payload(job)`) vs bag (`{ payload: job }`) — current sketch assumes chain, per D26
   (`.add` like HttpApi, not `.pipe`).

## 1.4 Identifier strings — brief for `.make`, canonical for `.Service` (owner, 2026-08-19)

**A `.make` id is a brief name, not a key path.** It mirrors `HttpApiGroup.make("users")`.
A `.Service` id stays the canonical slash-scoped form, because it is a real Context service and
*Canonical ids are slash-scoped* applies.

``` ts
// .Service — canonical, slash-scoped
Hyperlink.Service<Mover>()("app/Mover")
WorkPool.Service<Jobs>()("app/Jobs")
```

``` ts
// .make — brief
Hyperlink.make("mover")
WorkPool.make("jobs")
```

Precedent:

``` ts
// HttpApiGroup.ts:394 — a group id is a bare name
HttpApiGroup.make("users")
```

**Applies to every derived key.** When a builder mints a Context key from a contract id, the id it
embeds is the brief one; the package scope comes from the key prefix, not from the author:

``` ts
// runtime key minted by the layer builder
"hyperlink-ts/Impl/mover"
```

``` ts
// compare — HttpApiBuilder.ts:89
key.startsWith("effect/httpapi/HttpApiGroup/")
```

**Standards note:** *Canonical ids are slash-scoped* in
[`types-and-naming.md`](../standards/types-and-naming.md) currently reads as covering every
contract id. It needs a carve-out for non-service `.make` ids, or a sentence scoping it to
service and Context keys.

## 2. Helpers

Helpers are `Hyperlink.something` — not a separate module.

**Ruled out:** `Hyperlink.handle` (owner, 2026-08-18). `Hyperlink.layer` is undecided.
Naming slot for the client pair likely follows `HttpApiClient`'s `make` / `makeWith` split
(ambient transport vs. passed in) — e.g. `Hyperlink.client` / `Hyperlink.clientWith`. Open.

Requirement differs by input:

- client built from a **helper** → requirement is **just the protocol**
- client built from the **Service** → requires **that service**, which may be the real thing
  or just a client layer

## 2.5 Member modifiers (owner, 2026-08-19)

Constructors take **identity and schemas**. Modifiers are **methods with a real parameter**. No
member appears on both sides — v4's `Rpc` offers `setPayload` / `setSuccess` / `setError` *and* the
construction bag; we take one way per thing, except where deferral is the point (below).

``` ts
// constructors
Hyperlink.effect("tip", Schema.String)
Hyperlink.effectFn("send", Payload, Schema.Void)
Hyperlink.ref("status", StatusSchema)
Hyperlink.local<() => void>("drain")
Hyperlink.default("retries", 3)
```

``` ts
// modifiers
.fleet(options?)
.deprecated(options?)
.middleware(Auth)
.annotate(Description, "…")
```

### 2.5.1 Optional-parameter shape, boolean shorthand plus object

Effect drives boolean flags with `const B extends boolean = default` and a conditional return:

``` ts
// HttpApiGroup.ts:394
export const make = <const Id extends string, const TopLevel extends boolean = false>(
  identifier: Id,
  options?: {
    readonly topLevel?: TopLevel | undefined
  }
): HttpApiGroup<Id, never, TopLevel>
```

Applied, with an object form so options can be added later — `boolean` is the shorthand, the same
union-shorthand `Rpc.setPayload` uses for `Schema.Top | Schema.Struct.Fields`:

``` ts
export interface FleetOptions {
  readonly enabled?: boolean
}
```

``` ts
fleet<const O extends boolean | FleetOptions = true>(
  options?: O
): FleetEnabled<O> extends true
  ? FleetField<M>
  : M
```

``` ts
Hyperlink.effect("totalConnections", Schema.Number)
  .fleet()
```

``` ts
Hyperlink.effect("totalConnections", Schema.Number)
  .fleet(false)
```

``` ts
Hyperlink.effect("totalConnections", Schema.Number)
  .fleet({
    enabled: false,
  })
```

Chained:

``` ts
Hyperlink.ref("status", StatusSchema)
  .fleet()
  .deprecated("use health")
  .middleware(Auth)
```

### 2.5.2 `Pipeable` stays

All three Effect builders carry `Pipeable` **and** methods. Methods for the closed modifier set the
module owns; `pipe` for open extension:

``` ts
// src/Hyperlink.ts:530 — already Pipeable today
> extends Pipeable.Pipeable {
```

``` ts
Hyperlink.effect("tip", Schema.String)
  .pipe(someUserCombinator)
```

### 2.5.3 Deferred completion is why `set*` exists

`Rpc.setSuccess` has **zero call sites** in Effect's `src`, `test`, or `typetest` — it is a public
affordance for building a procedure and refining it later, which a one-shot bag cannot express:

``` ts
const base = Rpc.make("GetUser", {
  payload: UserId,
})
```

``` ts
const full = base
  .setSuccess(User)
  .setError(NotFound)
```

``` ts
const summary = base
  .setSuccess(UserSummary)
```

Open: whether Hyperlink members want the same `set*` family, or whether all members are always
complete at construction.

### 2.5.4 `fleet`'s fold is serve-side

``` ts
/**
 * Mark a contract method as a **fleet** field — one combined across the nodes
 * (its layer impl folds {@link peers} + its own value).
 */
export const fleet = <M extends AnyMethod>(method: M): FleetField<M> =>
  marked(method, { fleet: true as const })
```

The contract only carries the marker; the fold lives in the implementation. So `FleetOptions` holds
contract-level concerns only — `timeout` / `partial` / `include` are layer-side unless a reason
appears to hoist them.

### 2.5.5 v3 vs v4 — do not reintroduce chained schema setters

``` ts
// v3 — packages/platform/src/HttpApiEndpoint.ts:84
addSuccess<S extends Schema.Schema.Any>(…)
```

``` ts
// v4 — zero matches in HttpApiEndpoint.ts / HttpApiGroup.ts / HttpApi.ts
```

v4 moved them into the construction bag. We follow v4.

## 3. Default client — resolved via `Effect.serviceOption` (2026-08-18)

**Mechanism: `Effect.serviceOption`. `Context.Reference` is ruled out.**

### The answer

```ts
// Effect.ts:6125 — note the R channel: never
export const serviceOption: <I, S>(key: Context.Key<I, S>) => Effect<Option<S>> = internal.serviceOption
```

Asking whether a service is present does **not** require it to be present. So the tag stays an
ordinary `Context.Service`, and the client is the fallback:

```ts
const handle = <Self, S>(tag: HyperlinkTag<Self, S>) =>
  Effect.flatMap(
    Effect.serviceOption(tag),
    Option.match({
      onSome: Effect.succeed,          // served locally -> real impl
      onNone: () => dialClient(tag),   // not provided  -> client
    }),
  )
```

```ts
const jobs = yield* Jobs                    // one yield, no layer required
Effect.provideService(program, Jobs, impl)  // override -> plain provide
Layer.provide(program, Jobs.serve(impl))    // serving layer -> same
```

`R` is honest: `Effect<Wire<S>, never, Protocol>` — the service drops out of `R`, leaving only
what dialing actually needs. No prototype surgery, no `ReferenceTypeId`, all public API.

### Why the other five approaches failed

| Approach | Verdict |
|----------|---------|
| `Context.Reference` default | **No.** `defaultValue: () => Service` is sync, unscoped, infallible — cannot dial, cannot hold `Scope`, cannot fail |
| Reference holding the acquisition Effect | **No.** Double yield: `yield* (yield* Ref)` |
| Reference holding a lazy proxy | **Rejected.** `R` vanishes from acquisition, reappears per method |
| Default client *layer* | **Rejected.** A default that must be provided is not a default |
| Effect-provides-dependency wrapper | **No.** Provision covers what an effect *runs*, not an Effect it *returns* — a returned Effect keeps its requirement in the success type |

Source of the Reference constraint:

```ts
// Context.ts:1335 — sync thunk: no Effect, no Scope, no error channel
export const Reference: <Service>(
  key: string,
  options: { readonly defaultValue: () => Service }
) => Reference<Service>

// Context.ts:882 — default resolves on the *sync* read path
if (!self.mapUnsafe.has(service.key)) {
  if (ReferenceTypeId in service) return getDefaultValue(service as any)
  throw serviceNotFoundError(service)
}
```

### Still open on this mechanism

1. **Scope.** If `dialClient` acquires a socket, `Scope` joins `R`. Either `Protocol` owns the
   connection and `dialClient` returns a cheap handle, or `yield* Jobs` carries `Scope`.
2. **Memoization.** `serviceOption` re-checks on every yield, so a loop re-dials unless `Protocol`
   caches. Owner lean: that is the protocol's job, not the tag's.
3. **What you yield.** `serviceOption` is a function. Either it lives in the class's `evaluate`
   (so `yield* Jobs` does it), or `Jobs` is not the thing you yield. Undecided.

**Note:** items 1–3 are expected to be reshaped by the Node/Address work (§5). Do not lock this
before the address model lands.

## 4. Statics

**Eliminate all statics.** Leave the static namespace free for devs to add their own.

## 4.5 The minted `Self`, the key, and the implementation shape (owner, 2026-08-19)

### 4.5.1 What needed a name

`Hyperlink.Hyperlink` already has the slot:

``` ts
// src/Hyperlink.ts:3163
export type Hyperlink<
  S extends Spec,
  E = never,
  R = never,
  Self = unknown,
> = Effect.Effect<ServiceOf<S, Self>, E, Self | R>
```

`.Service` puts its class in `Self`. `.make` has no class, so it needs a **minted stand-in**.
It was never an "implementation" type — it is an identity.

**Decision: `Hyperlink.Self<Id>`.**

``` ts
const moverLocal = Layer.succeed(mover, impl)
// Layer<Hyperlink.Self<"mover">, never, never>
```

``` ts
const m = yield* mover
// Effect<ServiceOf<S>, never, Hyperlink.Self<"mover">>
```

Reads correctly beside the address requirement — one is who, one is where:

``` ts
Effect<Wire<S>, never, Hyperlink.Self<"mover"> | Address.Address<Mover> | Protocol>
```

`Identity` was rejected — `identitySym` / `Hyperlink.identity` / `IdentitySelfRequired` already mean
the Lookup identity-claim feature.

### 4.5.2 The key string

**Decision: `hyperlink-ts/<Module>/HyperService/<id>`.**

``` ts
"hyperlink-ts/Hyperlink/HyperService/mover"
"hyperlink-ts/WorkPool/HyperService/jobs"
"hyperlink-ts/Daemon/HyperService/prices"
```

Effect's segments are **package / directory / module / member / id**, with the member segment
present only when the key names a sub-thing:

``` ts
// effect/sql/SqlClient.ts:330
`effect/sql/SqlClient/TransactionConnection/${clientId}`

// effect/httpapi/HttpApiGroup.ts:378
`effect/httpapi/HttpApiGroup/${options.identifier}`
```

The module segment is **required** — brief `.make` ids are only unique per minting module:

``` ts
Hyperlink.make("jobs")
WorkPool.make("jobs")
```

``` ts
"hyperlink-ts/Hyperlink/HyperService/jobs"   // ✅ distinct
"hyperlink-ts/WorkPool/HyperService/jobs"    // ✅ distinct
"hyperlink-ts/HyperService/jobs"             // ❌ collides
```

**`HyperService` is cemented in the key, not in the type.** It appears once per key string; a type
named `Hyperlink.HyperService` would stutter in every hover. The term is already correct for
`.make`, because "Service" in this codebase means shape-of-capability, not Context key:

``` ts
export type ServiceOf<S extends Spec, Self = unknown>
export type WireServiceOf<S extends Spec>
type PeerServiceOf<S extends Spec>
```

None of the three require Context identity.

### 4.5.3 The type is parameterised by the id — a deliberate divergence

SqlClient's phantom is **not** generic in its id; the runtime string separates instances:

``` ts
export interface TransactionConnection {
  readonly _: unique symbol
}
```

We diverge, because two Hyperlink contracts in one Context must not be interchangeable:

``` ts
Layer<Hyperlink.HyperService, …>    // mover and jobs indistinguishable — rejected
Layer<Hyperlink.Self<"mover">, …>   // distinct — chosen
```

### 4.5.4 The implementation is a plain object

There is **no handler builder**. Implementing a contract is identical to implementing any Effect
service:

``` ts
const impl = {
  take: Ref.get(store),
  give: (items) => Ref.update(store, (a) => [...a, ...items]),
}
```

``` ts
const moverLocal = Layer.succeed(mover, impl)
```

``` ts
const moverLocal = Layer.effect(
  mover,
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const store = yield* Ref.make<ReadonlyArray<string>>([])

    return {
      take: Ref.get(store),
      give: (items) => limiter(Ref.update(store, (a) => [...a, ...items])),
    }
  })
)
```

**The builder is for everything else** — reachability, nodes, readiness, handoff, peers. Not for
producing the implementation.

### 4.5.5 Naming survey behind these calls

Effect mints phantom Context identities constantly, and names each for its **domain concept**,
never generically:

``` ts
Rpc.Handler<Tag>                          // rpc      — answers a call
Tool.Handler<Name>                        // ai       — answers a call
Workflow.Execution<Tag>                   // workflow — a run
Event.EventHandler<Tag>                   // eventlog — answers an event
Command.CommandContext<Name>              // cli      — ambient for a command
HttpRouter.Request<Kind, T>               // http     — what is handled
HttpApiGroup.Service<ApiId, Identifier>   // httpapi  — a group's implementation
SqlClient.TransactionConnection           // sql      — the scoped connection
```

Rejected along the way, with reasons:

| Candidate | Why not |
|-----------|---------|
| `Impl` | abbreviation |
| `Implementation` | names the wrong thing — the slot wants an identity |
| `Served` / `Serving` | not always served; and IPC-only is not "serving" |
| `Instance` | generic filler |
| `Handlers` | undersells it (refs, defaults, locals) and reuses a taken word |
| `Origin` / `Source` | locational — confusable with `Address.Address<X>` |
| `Identity` | taken by the Lookup identity-claim feature |
| `HyperService` (as the type) | stutters at every use site |

## 5. Address / Node as a requirement — owner-gated

Treat a Node / Address **literally as a requirement**.

```ts
Address.Address<MyService>   // service-scoped requirement
Address.Address<MyNode>      // when the node has no address of its own
```

- Resolve it by **providing a node** or a **direct address**.
- Provide it **at construction** → golden; the requirement comes from the address type.
- If your node doesn't have an address, the requirement reflects that — it is
  `Address.Address<MyNode>`, not `Address.Address<MyService>`.
- **Addresses are dependencies**, so they can carry **their own requirements** — more than just
  a protocol; some need extra dependencies.
- Making it a requirement simplifies a lot, especially because a node or address can be attached
  at different points.

**This needs great care and attention. Do not do this without the owner.** Preference is to
tackle it **as soon as reasonable**.

### 5.1 The hard part — multiple addresses

Nodes support **multiple protocols**, and **multiple addresses per protocol**. We need to be able
to **accumulate addresses**. Before building: think out exactly how multiple addresses should be
handled, and survey what others do for something similar.

## 6. Open questions

1. Does the default-client Reference need a no-default alternative, or is `.make` enough?
2. How does a requirement type carry N addresses without R becoming combinatorial?
3. What exactly does `.make` return — class or value — and does it keep `class X extends` form?

## 7. Work order (owner, 2026-08-18)

**Node/Address (§5) remains priority #1.** It is not the *first* task, because it will reshape
§1–§3; we want the surrounding shape visible before diving in.

| # | Step | State |
|---|------|-------|
| 1 | Document everything above | done |
| 2 | **WorkPool API mock-up** (§8) — lanes as groups, two builders, topLevel, payload-as-prefix | **next** |
| 2b | `Hyperlink.Service` / `Hyperlink.make` shape — after WorkPool, which is the foundation | after 2 |
| 3 | Lock the desired API shape — provisional, explicitly **not final** | after 2 |
| 4 | Node/Address as a requirement (§5) — the #1 priority | owner-gated, after 3 |

Rationale: step 3 gives a full picture of everything else in motion before step 4 starts. Nothing
in steps 2–3 is binding; the address model may invalidate any of it.

## 8. WorkPool redesign — lanes as groups (owner, 2026-08-18)

**WorkPool is the centerpiece of the package and the foundation the included service factories
build on. Its API is designed first; `Hyperlink.Service` / `Hyperlink.make` follow.**

### 8.1 The contract/layer discipline

Borrowed from HttpApi, and the rule that makes the two-part split worth having:

> Most things do **not** belong in the contract. Only what the **client** needs, what **must** be
> in the class/const, or anything that **affects the type**. As much as reasonable goes in the
> **layer**.

Two builders per pool: one builds the handle/contract, one builds the layer.

### 8.2 Lanes become groups

A WorkPool lane maps to an `HttpApiGroup`. Consequences:

- `add`, `defer`, `priority` stop being built-in methods on the pool
- you declare **lanes** instead; the right configuration across the two builders reproduces the
  current three lanes exactly
- **custom priority merges into WorkPool** — `CustomQueueResource` stops being a separate concept,
  because a custom priority scheme is just a different set of lanes

### 8.3 `topLevel` keeps the simple case simple (Agent 6, accepted into the design)

HttpApi's `topLevel` exists so a one-group api does not force `client.group.method()`:

```ts
// HttpApiGroup.ts:394
export const make = <const Id extends string, const TopLevel extends boolean = false>(
  identifier: Id,
  options?: { readonly topLevel?: TopLevel | undefined }
): HttpApiGroup<Id, never, TopLevel>
```

Lanes need the same escape, or every pool pays lane syntax for a feature most pools do not use:

```ts
jobs.add(job)          // topLevel lane — the common case survives
jobs.urgent.add(job)   // named lane
```

### 8.4 `.payload` behaves like `.prefix`

Keep `.payload`, but as a **contract-wide modifier that pushes down into members**, exactly as
HttpApi's `prefix` maps over every group which maps over every endpoint:

```ts
// HttpApi.ts:94
prefix<const Prefix extends PathInput>(prefix: Prefix): HttpApi<Id, HttpApiGroup.AddPrefix<Groups, Prefix>>

// HttpApi.ts:173 — pushes down
prefix(this: Top, prefix: PathInput) {
  return … Record.map(this.groups, (group) => group.prefix(prefix))
}
```

Lanes may **optionally narrow** the pool payload with their own schema.

**Open (Agent 6):** narrowing should be constrained to a subtype of the pool payload, or enqueue
gets decode surprises. Needs a decision.

### 8.5 `.add` vs config

`.add` in HttpApi adds **members**. Config that is not a member arrives at `make` or via
annotations — never `.add`. Applied here:

```ts
// lanes are members -> .add
WorkPool.make("jobs")
  .add(lane, lane)

// pool config -> make bag
WorkPool.make("jobs", { … })

// contract-wide modifier -> prefix-style
WorkPool.make("jobs")
  .payload(job)
```

Consistent with **D26** (`make` + `.add`, not `.pipe`).

### 8.6 Approved shape (owner, 2026-08-18)

```ts
class Jobs extends WorkPool.make("jobs")
  .payload(Job)
  .add(
    WorkPool.lane("urgent", {
      payload: UrgentJob,
      success: Receipt,
      error: Rejected,
    }),
    WorkPool.lane("batch"),   // inherits Job
  )
{}

const jobs = yield* Jobs

yield* jobs.urgent({ id: "a", deadline: 1000 })
yield* jobs.batch({ id: "b" })
```

Lane options are a **bag**, matching v4 — `addSuccess` / `addError` are **v3 only**
(`packages/platform/src/HttpApiEndpoint.ts:84` on the `v3` branch; zero matches in v4's
`HttpApiEndpoint.ts` / `HttpApiGroup.ts` / `HttpApi.ts`).

### 8.7 Payload inheritance and ordering

`payload` is optional on a lane and inherits the pool's. Resolution happens at `.add`, because a
lane is constructed standalone and cannot see the pool at its own construction — same as HttpApi,
where the parent applies `prefix` by mapping over children (`HttpApi.ts:173`).

```ts
// ✅ inherits
WorkPool.make("jobs")
  .payload(Job)
  .add(
    WorkPool.lane("batch")
  )

// ✅ own
WorkPool.make("jobs")
  .add(
    WorkPool.lane("batch", {
      payload: Job,
    })
  )

// ❌ unresolved
WorkPool.make("jobs")
  .add(
    WorkPool.lane("batch")
  )
```

**Ordering rule (Agent 6 call, owner approved): `.payload` must precede `.add`.** No backfill.
Backfill would force `.add` to accept unresolved lanes in case `.payload` arrived later, making
the unresolved state representable and moving the error off the offending line.

### 8.8 Transforms vs requirements

The general rule this produced:

> **Transforms compose, so they may follow `.add`. Requirements resolve, so they must precede it.**

| | Behaviour | Position |
|---|---|---|
| `payload` | replaces — leaves a hole if absent | **before** `.add` |
| `success` | replaces | **before** `.add` |
| `middleware` | unions into `E` and `R` | after `.add` ok |
| `error` | unions into `E` | after `.add` ok |
| `annotateLanes` | Context merge (HttpApiGroup.annotateEndpoints) | after `.add` ok |
| `prefix` | string concat on lane keys | after `.add` ok |

```ts
class Jobs extends WorkPool.make("jobs")
  .payload(Job)
  .add(urgent, batch)
  .middleware(RateLimit)
  .error(QueueFull, Backpressured, PoolShuttingDown)
  .annotateLanes(Description, "…")
{}
```

Pool-level `.error` is the strongest of these — infra failures are uniform across lanes and
declaring them per-lane is pure repetition. `prefix` is the weakest: lane keys are flat, so it
only earns its place if two pools are ever composed into one, which nothing in the design does.

### 8.9 Target slot — node / address (provisional, pending §5)

Optional second arg to `make`, plus two transforms that fill the **same slot**:

```ts
// .node ✓  .address ✓
WorkPool.make("jobs")

// .node ✗  .address ✗
WorkPool.make("jobs", Worker)

// .node ✗  .address ✗
WorkPool.make("jobs")
  .node(Worker)

// .node ✗  .address ✗
WorkPool.make("jobs")
  .address(
    Address.http(":8080")
  )
```

**Removed from the type once filled — never a silent overwrite.** A node is a routing change;
last-write-wins hides it. Consistent with §8.8: a node does not union with another node.

```ts
WorkPool.make("jobs", Worker)
  .node(Other)
//^ .node does not exist on a targeted pool
```

Re-targeting a contract declared elsewhere, if ever needed, gets its own verb rather than a quiet
overwrite — e.g. `WorkPool.retarget(Jobs, Other)`. Not designed.

### 8.10 Multiple addresses — only through a Node

`.address` never accumulates. Multiplicity already lives **inside** one Address value (D27/D28):

```ts
.address(
  Address.http([8080, 8081])
)

.address(
  Address.http({
    blue: 8080,
    green: 8081,
  })
)

.address(
  Address.http(
    Address.range(":8080", ":8090")
  )
)
```

The only thing accumulation would add is **across protocols** — which is what a Node is. Allowing
it directly would recreate node semantics (selection, labels, primary/backup, `.proxy()`) without
node identity, and `NodePolicy` already owns all of that.

```ts
.address(…)     // one protocol, any number of dials — simple case
.node(Worker)   // many protocols, policy, labels, proxy — real case
```

### 8.11 Still open

1. **What `success` means on a lane** — the enqueue ack, or the handler's output? Different handle
   signatures and different layer shapes.

   ```ts
   yield* jobs.urgent(job)   // Effect<Receipt>  — enqueue ack
   yield* jobs.urgent(job)   // Effect<Result>   — handler output
   ```
2. **`topLevel`** — no counterpart survives the group/endpoint merge. Drop, or repurpose as
   "default lane" under a name that says so.
3. **Per-lane targets** — lanes on different nodes is a real fleet shape the lane pivot newly
   makes expressible, but it multiplies the §5 requirement into one per lane. Deferred to §5.

### 8.11b Derived keys and the `Impl<Id>` entry (owner, 2026-08-19)

A `.make` contract is not a Context key, so the **layer builder mints one** from the contract id —
the same mechanism HttpApi uses for groups:

``` ts
// HttpApiBuilder.ts:119
export const group = <ApiId, Groups, const Name extends HttpApiGroup.Name<Groups>, Return>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  groupName: Name,
  build: (handlers: Handlers.FromGroup<…>) => Handlers.ValidateReturn<Return>
): Layer.Layer<
  HttpApiGroup.ApiGroup<ApiId, Name>,
  …
>
```

``` ts
// the runtime key is a plain string
Context.makeUnsafe(
  new Map([[group.key, { routes, handlers: handlers.handlers }]])
)
```

Applied:

``` ts
Hyperlink.layer(mover, impl)
// Layer<Hyperlink.Impl<"mover">, E, R>
```

``` ts
Hyperlink.layer(Mover, impl)
// Layer<Hyperlink.Impl<"mover"> | Mover, E, R>
```

`.Service` provides one extra thing — itself. That is the entire difference at the helper boundary.

**The local handle** is the same key read back:

``` ts
const m = yield* Hyperlink.get(mover)
// Effect<ServiceOf<S>, never, Impl<"mover">>
```

``` ts
const m = yield* Hyperlink.get(Mover)
const m = yield* Mover
```

**DI is closed by this.** `Impl<Id>` is a real Context entry, so a `.make` implementation both
receives and provides dependencies:

``` ts
const moverLocal = Hyperlink.layer(
  mover,
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const sem = yield* Effect.makeSemaphore(4)

    return {
      take: sem.withPermits(1)(Ref.get(store)),
      give: (items) => limiter(Ref.update(store, (a) => [...a, ...items])),
    }
  })
)
// Layer<Impl<"mover">, never, RateLimiter>
```

Remaining gap, not a requirement: a dependency needed at **contract construction** rather than
inside the impl. A `.make` value is module scope, so that case stays out of reach.

### 8.12 Status

Contract shape settled to the extent it can be before §5. Layer-side shape (`WorkPool.layer` /
handler registration) not yet designed.

## Notes (Agent 6 — not owner decisions)

- `Context.Reference`'s `defaultValue` is a **sync, unscoped thunk**
  (`defaultValue: () => Service`). It cannot allocate a connection. A default client therefore has
  to be a **lazy proxy** whose methods resolve/memoize the protocol per call, not a live
  connection built at default time. This is the one place the plan has a real hole to close.
- "Eliminate all statics" can reach zero *Hyperlink* statics, but `Context.Service` itself puts
  `key` / `of` / `context` / `use` / `useSync` on the class. Target should be stated as
  "no statics of ours."
- Recommend multiplicity live in the **value**, not the type: one
  `Address.Address<X>` requirement, satisfied once, with N addresses inside — otherwise R changes
  shape per protocol.
