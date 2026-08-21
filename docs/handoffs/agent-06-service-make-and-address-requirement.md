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

## 1.5 `.Service` is only for shape-minting modules — Node takes `make` alone (owner, 2026-08-21)

**`.Service` was never approved for `Node`.** The two-constructor split in §1 is a HyperService
pattern: it exists because those modules mint a *service shape*. A node does not — its shape is
fixed:

``` ts
// src/internal/nodeCore.ts:614 — every node, from either constructor
const node = Object.assign(Context.Service<Self, NodeProtocol>()(key), { … })
```

`Node.Service` is a `Context.Service` wearing a hardcoded `NodeProtocol`. The name claims a shape it
does not mint.

#### Provenance

``` text
2026-07-20  35dee4e7  Node module extracted from Resource/Lookup, as Node.Tag
2026-07-20  81ba1d21  AddressedNode — this is what put dials on the class
2026-07-20  ea66f46b  Node.Tag becomes two-stage + keyed, to mirror Context.Service
2026-08-04  a3831b5f  Effect v4 sweep renames Tag → Service across the repo
2026-08-11  5ef27c20  Address factories + Node.make
```

`Node.Service` is the July `Node.Tag` carried through a mechanical v4 rename. `Node.make` and the
`Address.*` factories are the newer design and supersede it. The nine inline-target overloads on
`Node.Service` came in with `AddressedNode` and are the thing 5.5.5 is undoing.

#### Why this does not break the locked arity

`node-addresses-and-update-api.md:428` locks `Node.make(key, Address | Address[], options?)`. Adding
a `<Self>()` stage would break it. It is not needed.

Effect v4 draws exactly this line itself — one stage yields a value, two stages yield an extendable
class:

``` ts
// repos/effect/packages/effect/src/Context.ts:201
<Identifier, Shape = Identifier>(key: string): Service<Identifier, Shape>
```

``` ts
// :202
<Self, Shape>(): <const Identifier extends string, …>(id, options?) =>
  ServiceClass<Self, Identifier, Shape> & …
```

``` ts
// :124 — the class form is a strict superset of the value form
export interface ServiceClass<in out Self, in out Identifier extends string, in out Shape>
  extends Service<Self, Shape>
{
  new(_: never): ServiceClass.Shape<Identifier, Shape>
  readonly key: Identifier
}
```

That superset relation is also what makes `.make` and `.Service` outputs interchangeable in helpers
(§2) — it is Effect's own guarantee, not ours.

The decisive part is what lands in `R`:

``` ts
// :102
use<A, E, R>(f: (service: Shape) => Effect<A, E, R>): Effect<A, E, R | Identifier>
```

`Identifier` is the requirement entry, and it is not required to be the subclass. A HyperService
needs `<Self>()` because only the subclass can name a varying shape. A node's shape is fixed and its
identity is fully determined by its key — which `Node.make` already captures as a const:

``` ts
// src/internal/nodeMake.ts:145
readonly key: Key
```

So `Self` is branded from `Key`, and the arity stands:

``` ts
class Worker extends Node.make("app/Worker", [
  Address.unix("/var/run/w.sock"),
  Address.http(8080)
]) {}
// R entry: NodeId<"app/Worker">
```

``` ts
class Edge extends Node.make("app/Edge", Address.http(8080)) {}
// R entry: NodeId<"app/Edge"> — distinct, no <Self>() stage
```

#### The gap to close

`Node.make` currently throws `Self` away, so every node collapses to the same `R` entry:

``` ts
// src/internal/nodeMake.ts:144 — generics unbound, Self becomes unknown
export type NodeMakeDef<…> = ReturnType<typeof assembleNode> & { … }
```

That hole is why the two constructors never merged, and it is one type-level change.

#### Consequences

1. `Node.Service` is removed, along with its nine inline-target overloads.
2. `Node.make` is the sole node constructor; addresses are `Address.*` values only.
3. `.pipe` (policy fragments, extra addresses) and `assertNoDialOverlap` — both already on
   `Node.make` — become the only path, so D24 runs on every node.
4. All 20 call sites are `class X extends Node.make(…)`; there are no anonymous uses to preserve.
5. The rule generalises: **`.Service` belongs to modules that mint a shape.** Modules that mint
   identity over a fixed shape take `make` alone.

## 1.6 Module check — where `.Service` earns its keep (2026-08-21)

The 1.5 rule run across every module that exports a `Service` constructor.

**Restated rule.** 1.5's binary wording ("mints a shape" vs "fixed shape") misfiles `ShardMap`. The
rule that files all nine correctly:

> **`.Service` when the constructor's arguments change the service's *type*; `make` when they only
> change its *identity*.**

```
module        constructor site                    shape                                verdict
Hyperlink     src/Hyperlink.ts                    user spec                            .Service
WorkPool      src/internal/workPool.ts:3735       varies with T / E                    .Service
Group         src/Group.ts:53                     { members: Members }, user-supplied   .Service
Store         src/Store.ts:1450                   varies with contracts                .Service + drift fix
ShardMap      src/ShardMap.ts:308                 names fixed, types vary              .Service
Node          src/internal/nodeCore.ts:688        NodeProtocol, fixed                  make
Daemon        src/Daemon.ts:2273                  DaemonSpec / ScheduleHyperlinkSpec   make
FleetHealth   src/FleetHealth.ts:171              FleetHealthTag, fixed                make
Telemetry     src/Telemetry.ts:295                TelemetryTag, fixed                  make
```

#### ShardMap is the third tier

Node varies in nothing. Group varies in member *names*. ShardMap varies only in member *types* — and
that still mints a shape, so it keeps `.Service`:

``` ts
// src/ShardMap.ts:308
<Self>() =>
<Key extends Schema.Top, Value extends Schema.Top, Error extends Schema.Top = typeof Schema.Never>(
  key: string,
  schemas: ShardMapSchemas<Key, Value, Error>
): ShardMapTag<Self, Key, Value, Error> => …
```

#### Daemon selects a fixed spec, it does not mint one

``` ts
// src/Daemon.ts:1678 — a value
export const daemonSpec = buildDaemonSpec()
export type DaemonSpec = typeof daemonSpec
```

``` ts
// every overload returns one of two fixed specs, and delegates the minting
): NodeBoundTag<Self, ScheduleHyperlinkSpec, HSelf>
Hyperlink.Service<Self>()(key, scheduleHyperlinkSpec, tagOptions)
```

#### FleetHealth and Telemetry are the same constructor twice

Neither takes a key — it is derived:

``` ts
// src/FleetHealth.ts:155
const defaultKey = "fleet-health"
const keyFor = (node: NodeKey<unknown> | undefined): string =>
  node === undefined ? defaultKey : `${node.key}/${defaultKey}`
```

`Self` is inert in both branches: the bare form is a singleton on a constant key, and the node-bound
form is already branded by `HSelf` in `FleetHealthNodeTag<Self, HSelf>`.

``` ts
FleetHealth.make()
FleetHealth.make({ node: Droplet })
```

#### Store — drift, not a naming question

Store keeps `.Service`. Its shipped signature diverged from its own design doc on three axes at once:

```
                design (store-and-logs-design.md:65)   shipped (src/Store.ts:1450)
arity           Service<Self>()(key)                   Service<Self>(key)
registrations   .add(reg, reg, reg)                    (…contracts) as a second call
key type        "@app/Store"                           string
```

The key-type row is a live defect — the conditional is dead:

``` ts
// src/Store.ts:1451 — string extends string ? string : never  ≡  string
defineStoreTag<Self, typeof id extends string ? typeof id : never>(id)
```

So every store's key type is `string` and no two stores are distinguishable by key. Same class of
hole as `NodeMakeDef` collapsing `Self` (1.5).

``` ts
class AppStore extends Store.Service<AppStore>()("@app/Store").add(
  WorkPool.store(Mail),
  Daemon.store(Daily),
  LabThermometer.store
) {}
// StoreServiceClass<AppStore, "@app/Store", …>
```

41 call sites; the ones already in `store-and-logs-design.md` are in target form. Note the design says
`.pipe` — that is superseded by `.add` per D26 and §6.8.

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

### 4.5.2b Alternatives weighed

``` ts
// A — module as construct
"hyperlink-ts/WorkPool/jobs"
```

``` ts
// B — module, then construct    ← CHOSEN
"hyperlink-ts/WorkPool/HyperService/jobs"
```

``` ts
// C — construct, then module
"hyperlink-ts/HyperService/WorkPool/jobs"
```

**A rejected.** One segment does two jobs, so user ids sit directly in the module's namespace and
leave no reserved space for anything else that module keys. `SqlClient` shows the shape A cannot
support:

``` ts
"effect/sql/SqlClient/SafeIntegers"
`effect/sql/SqlClient/TransactionConnection/${clientId}`
```

The Hyperlink module already keys several things beyond contracts (`peersSym`, `selfNodeSym`,
`localCapSym`); under A a contract named `"peers"` would compete with machinery.
`HttpApiGroup` escapes this only because its module exists for exactly one construct.

**C rejected — and the argument first made for it was wrong.** The claim was that construct-first
enables a single-prefix scan for every HyperService, citing:

``` ts
// HttpApiBuilder.ts:89
key.startsWith("effect/httpapi/HttpApiGroup/")
```

That prefix exists because `HttpApiGroup` builds its key there for **identity**; the scan piggybacks
on a namespace that already existed. It was not designed to enable filtering. What survives is
minor: a cross-module scan needs a known module list under B and does not under C. Both Effect
precedents are module-first, so B holds.

### 4.5.2c Scope — every contract-minting module

This is **not** a Hyperlink-only change. Each of these mints contracts and needs the same brief id,
minted `Self`, module-scoped key, and plain-object implementation:

``` ts
// src/WorkPool.ts:2370
export { queueTag as Service }

// src/Gate.ts:1238
export { runTag as Service }

// src/Gate.ts:730
const tag = Hyperlink.Service<Self>()(key, spec, { … })

// src/Daemon.ts:2273
export const Service = <Self>() => {
```

Plus modules exporting their own `Service`:

```
src/Group.ts   src/FleetHealth.ts   src/ShardMap.ts   src/Store.ts   src/Telemetry.ts
```

So the full surface is:

``` ts
Hyperlink.make("mover")
WorkPool.make("jobs")
Daemon.make("prices")
Gate.make("checkout")
Group.make(…)
Store.make(…)
Telemetry.make(…)
FleetHealth.make(…)
ShardMap.make(…)
```

**The type is shared; the key varies by minting module.**

``` ts
Hyperlink.Self<"mover">
Hyperlink.Self<"jobs">
Hyperlink.Self<"prices">
```

``` ts
"hyperlink-ts/Hyperlink/HyperService/mover"
"hyperlink-ts/WorkPool/HyperService/jobs"
"hyperlink-ts/Daemon/HyperService/prices"
"hyperlink-ts/Gate/HyperService/checkout"
```

The substrate lives in one place and each module re-exports it, the way `WorkPool` and `Gate`
already re-export `Service`.

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

## 5.5 Address / Node — exploration state (2026-08-19, nothing locked)

### 5.5.1 The model a node actually has

A node is not a list of dials. It is a **labelled space** — protocol x label — and four different
questions are asked of that one space:

```
Worker
├── http
│   ├── (unlabelled)  :8080
│   └── (unlabelled)  :8081
├── unix
│   ├── A             /var/run/w.a.sock
│   └── B             /var/run/w.b.sock
└── ws
    └── (unlabelled)  :9000
```

```
bind       which of these does THIS process open?
advertise  which go in the Directory row?
dial       which may a client use?
active     which is the proxy forwarding to?
```

Mapping to the scenario catalogue in
[`node-addresses-and-update-api.md`](./node-addresses-and-update-api.md) §3.0:

```
S4  advertise ⊂ bind
S11 all three differ
S5  dial fixed while active moves
S14 dial has several members
```

So they are not four features — they are four selections over one set.

### 5.5.2 Four candidate structures

| | Where a node's shape lives | Weakness |
|---|---|---|
| **A** declaration-first | in the class | S7 — binding is per-process, a class cannot describe two processes |
| **C** address-first | spread across address values | no single view of a node; D24 overlap becomes whole-program |
| **D** layer-first | in the layers you provide | simple case pays for it |
| **E** document-first | in a topology document | types stop helping; the requirement stops carrying information |

**Direction: D, with A as sugar over it.** The declaration auto-provides the obvious layers, so the
one-line case stays one line and S7 works by not using the sugar.

``` ts
// the model
class Worker extends Node.make("worker") {}
```

``` ts
Address.layer(Worker, Address.http(":8080"))
```

``` ts
// the sugar — same arguments, provides the layer for you
class Worker extends Node.make("worker")
  .add(
    Address.http(":8080")
  )
{}
```

Holds the §3 constraint: *whether an address was on `make` or piped on afterward, the result is the
same.*

### 5.5.3 Two requirements, not one — an address mints a node (owner)

The parameterisation argument dissolves once passing an **address** mints an anonymous node:

``` ts
Node.Node<Mover>          // a service needs a node
Address.Address<Worker>   // a node needs an address
```

``` ts
class Mover extends Hyperlink.make("mover") {}
// Effect<Wire<S>, never, Node.Node<Mover> | Protocol>
```

``` ts
class Mover extends Hyperlink.make("mover", Worker) {}
// Effect<Wire<S>, never, Address.Address<Worker> | Protocol>
```

``` ts
class Mover extends Hyperlink.make("mover", Address.unix("/var/run/m.sock")) {}
// Effect<Wire<S>, never, Protocol>          — address minted a node
```

Neither requirement ever changes shape, which kills the earlier
`Address<Service>` vs `Address<Node>` problem, the synthetic-`Mover.Node` problem, and gives
discovery layers one stable signature:

``` ts
const layerFromLookup = <N extends AnyNode>(node: N):
  Layer<Address.Address<N>, LookupClientError, Lookup.Client>
```

### 5.5.4 `Address.layer` is variadic

``` ts
Address.layer(Worker, Address.http(":8080"))
```

``` ts
Address.layer(
  Worker,
  Address.http(":8080"),
  Address.unix("/var/run/w.sock").private(),
)
```

``` ts
export const layer: <
  N extends AnyNode,
  const As extends NonEmptyReadonlyArray<Address.Any>,
>(
  node: N,
  ...addresses: As
) => Layer.Layer<Address.Address<N, Address.LabelsOf<As>>, never, never>
```

Same argument shape as `.add`, `const` inference keeps labels, `NonEmptyReadonlyArray` makes a
dial-less node a compile error. Matches `RpcGroup.make(...rpcs)` / `HttpApiGroup.add(...endpoints)`.

### 5.5.5 Private dials move to layers; the two-class form retires (owner)

``` ts
// today — dials live on the class, so a second class hides them
class Worker extends Node.make("fleet/Worker", Address.http(":8080")) {}
class WorkerPrivate extends Worker.pipe(Address.unix({ A: "…", B: "…" })) {}
```

``` ts
// under D — the class carries no dials, so there is nothing to hide
Address.layer(
  Worker,
  Address.http(":8080"),
  Address.unix({ A: "…", B: "…" }).private(),
)
```

`.private()` here is dropped along with the reach exploration — see 5.5.6. The rest of this
subsection stands.

What the two-class form was costing: two answers to "which node is this service on", two requirement
types for one node, and D24 overlap needing to know they are the same node.

What is lost: a consumer importing `Worker` could not *name* a private dial. Naming is not dialing —
`dial` is the advertised subset, and reachability was always physical. Accepted.

`Private.pipe` retires as one complete change per the no-shims rule.

### 5.5.6 Reach — explored and dropped (owner, 2026-08-21)

A locality tier on addresses (`machine` / `fleet` / `public`), with per-protocol ceilings, defaults
inferred from string literals, a runtime mismatch error, a ceiling on `Advertise`, proxy direction
rules, and an `Update.simulate` widening check. Nine mechanisms. Cut in full.

The motivating worry was that a Unix socket could be dialed from across a network. It cannot — that
is physics, and nothing was ever at risk. 5.5.5 had already handled the real version of it by moving
private dials to layers.

The one piece with a concrete bug behind it — "machine-tier addresses must not be published to
Directory" — is wrong. Unix paths are advertised deliberately:

``` ts
// src/internal/nodeIpcServer.ts:59
// Soft Lookup directory advertise after serve registration (Node.unix / protocol listen)
```

An all-IPC fleet on one box has every peer reading a Directory full of unix paths. Whether a row is
publishable depends on who reads the Directory, not on the address. With that gone, the rest had
nothing under it.

The facts the tier kept restating are already enforced by the API:

``` ts
Address.http(8080)
// binds 127.0.0.1 — nodeHttp.ts:449
```

``` ts
Node.httpServer(…)
// anything wider — you bring the server
```

#### Two survivors

**1. `dialIdentity` keys on the shape of the input, not the socket.** A plain defect, unrelated to
reach:

``` ts
// src/internal/address.ts:119
Address.http(8080)                          → Http:port:8080
Address.http("http://localhost:8080/rpc")   → Http:url:http://localhost:8080/rpc
```

One socket, two identities, no `AddressDialOverlap`. `nodeMake.ts:82` derives the second from the
first, so they are the same string one step later. Fixing it means normalising to a socket identity
and replacing the `Set` in `assertNoDialOverlap` with a pairwise `covers` test, so bind-any is seen
to cover loopback rather than compare equal to it.

**2. Unreachable rows should fail at dial, not in the type.** The honest home for the original
worry, and it catches the cross-machine case a type never could — the type does not know where the
reader runs:

``` ts
Dialers.dial(row)
// AddressUnreachable: "unix:/var/run/w.sock" is not reachable from this host
```

### 5.5.7 Open threads for the deep pass

1. **The minted node's identity.** What key does `Hyperlink.make("mover", Address.unix(…))` mint?
   How does it appear in Directory rows and errors? Is it replaceable later
   (`Node.layer(Mover, Worker)`) or is minting a commitment?
2. **Two services minting from the same dial** — one node with two services, or two nodes colliding?
   This is exactly what D24 exists to catch.
3. **Does the sugar preserve D24?** If `.add(…)` auto-provides layers, can overlap still be seen
   locally? If not, A becomes the real model and D the escape hatch.
4. **Is `advertise` a third role or a bind option?** If it never differs from bind outside S4, it
   collapses.
5. **Roles (S7).** `Worker.role("edge")` was floated and is unconvincing. Same identity, different
   per-process bind may need nothing beyond not using the sugar.
6. **Fleets.** `nodes([A, B])` — one requirement or one per node? Interacts with the existing
   single-node rule for identity-stamped tags (S1).
7. **`.proxy()` and `active`.** Is the proxy target a requirement or purely a runtime activation?
   `Update`'s A→B cutover already flips it.
8. **Per-lane targets** (§8.11) — deferred here; multiplies whatever §5 settles on.

## 6. Configuration — presence, References, and the listen builder (owner, 2026-08-21)

Supersedes the `NodePolicy` / `LookupPolicy` / `PolicyBuilder` arrangement. Reached by asking whether
the policy modules were the right path at all; Effect has no equivalent, and the reason is
structural.

### 6.1 The inventory — five spellings for one idea

```
1  PolicyBuilder clusters      NodePolicy (5 keys), LookupPolicy (7 keys)
2  bare Context.Reference      Hyperlink.DeferStart, Lookup.PlanForce, Lookup.PlanStatus,
                               Launcher.AlreadyUp, DynamicConfig.SwappableRegistry
3  constructor options bags    NodeMakeOptions, DaemonTagOptions, FleetHealthConstructOptions
4  layer/serve options bags    HttpServerOptions, IpcServerOptions, ServeOptions, StoreLayerOptions
5  call-site stamps            ListenOptions, LookupClientOptions, VerifyConnectionOptions
```

### 6.2 The disease — `onConflict` exists in three of them

``` ts
// src/internal/nodeCore.ts:240
// Directory advertise conflict (call-site; wins over node stamp / LookupPolicy.Conflict)
```

```
LookupPolicy.Conflict        a Reference          ambient
node onConflict              a constructor stamp  per-declaration
ListenOptions.onConflict     a call-site bag      per-call
```

One knob, three spellings, and a hand-written precedence chain (`nodeCore.ts:538`, `:849`, `:921`) to
reconcile them.

### 6.3 Effect's three mechanisms

**Options bag on the layer function** — serve-time settings:

``` ts
// unstable/rpc/RpcServer.ts:768
export const layer = (group, options?: {
  readonly concurrency?: number | "unbounded" | undefined
  readonly disableTracing?: boolean | undefined
})
```

**Presence in Context** — selection:

``` ts
// unstable/httpapi/HttpApiBuilder.ts:88
const availableGroups = Array.from(services.mapUnsafe.keys()).filter((key) =>
  key.startsWith("effect/httpapi/HttpApiGroup/")
)
```

An `HttpApi` declares every group; a process serves the groups whose layers were provided. There is
no `Listen` knob because there is nothing to filter — you provide it or you do not.

**`Context.Reference`** — behavior with a default, in two placements. Ambient:

``` ts
// References.ts:387 — 14 of them, plain, PascalCase, no builder
export const MinimumLogLevel: Context.Reference<LogLevel> = references.MinimumLogLevel
```

``` ts
// Effect.ts:8011 — an ergonomic setter only where one earns it
export const withTracerEnabled: { … }
```

…and annotated onto a declaration:

``` ts
// unstable/cluster/ClusterSchema.ts:26
export const Persisted = Context.Reference<boolean>("effect/cluster/ClusterSchema/Persisted", { … })
```

``` ts
// unstable/cluster/ClusterWorkflowEngine.ts:675
.annotate(ClusterSchema.Persisted, true)
.annotate(ClusterSchema.Uninterruptible, true)
```

`HttpApi` carries the same pair:

``` ts
// HttpApi.ts:108
annotate<I, S>(tag: Context.Key<I, S>, value: S): HttpApi<Id, Groups>
annotateMerge<I>(context: Context.Context<I>): HttpApi<Id, Groups>
```

Notably absent from Effect: anything resembling `PolicyBuilder` — a generated family of PascalCase
References plus camelCase layer helpers plus a `Config` bag plus merge semantics.

### 6.4 The rule — one Reference, three placements, Context resolves precedence

Precedence is not something to implement. Context resolution *is* precedence, and HttpApi says so:

``` ts
// HttpApi.ts:75
// Annotation precedence from least to most specific is this API, the added API,
// the group, and then the endpoint.
```

``` ts
// ambient — the process default
Layer.provideService(Lookup.Conflict, "replace")
```

``` ts
// declaration — this node's default
class Worker extends Node.make("fleet/Worker").add(
  Address.http(8080)
).annotate(Lookup.Conflict, "replace") {}
```

``` ts
// call site — most specific
Hyperlink.layer(Jobs, jobsImpl).pipe(
  Layer.provideService(Lookup.Conflict, "replace")
)
```

Same name, same value type, three scopes, zero precedence code.

### 6.5 NodePolicy dissolves

Every knob is mechanism 1 or 2, neither of which needs a module.

```
knob                    mechanism   becomes
NodePolicy.Listen           2       provide the protocol layer, or don't (6.8)
NodePolicy.Advertise        2       presence, or an option on the listen layer
NodePolicy.As               2       Worker.unix("A") — a subset (6.8)
NodePolicy.PrimaryAddress   —       dissolves; see 6.6
NodePolicy.Proxy            —       un-replaced; see 6.15 item 1
```

Supporting evidence that the stamp was never load-bearing: `NodePolicyConfigKey` is written at
`nodeMake.ts:237` and read only by `nodePolicyOf`, whose only callers are its own tests
(`test/node-make.test.ts:27`, `:44`). No runtime path consumes it.

### 6.6 `PrimaryAddress` dissolving forces labels

`PrimaryAddress` meant *which declared address clients should use* — a concept that only exists
because the class declares a superset. Under presence-selection the advertised set is whatever this
process bound, so "primary" has no referent.

That removes the rule which made several unlabeled same-protocol addresses meaningful:

```
NodePolicy.PrimaryAddress = "AllUnlabeled"
// every unlabeled address (several same-protocol OK; list, not last-wins)
```

Re-deriving from why a node would declare two http addresses:

``` ts
// 1 — A/B cutover. Labeled; each process picks a side.
Address.http({ A: "…", B: "…" })
```

``` ts
// 2 — different service sets per port. Binding both with the same services is exactly wrong.
Address.http("public", 8080)
Address.http("admin", 8081)
```

Case 2 is the common one — and it is what the dropped reach exploration (5.5.6) was actually
reaching for. Serving a different *service set* on the socket is the honest mechanism; a locality
tier was not.

**So a label becomes required as soon as a protocol appears twice**, enforced by the type rather
than resolved by a knob:

``` ts
Worker.http()
// type error: "public" | "admin" — name one
```

### 6.7 LookupPolicy keeps the knobs, loses the machinery

None of LookupPolicy's seven keys filter a list; they are ambient dial-time behaviors with defaults,
read deep in the call path. That is exactly `Context.Reference`, and Effect writes them by hand.

``` ts
// src/LookupPolicy.ts:272 — today
.key("Sticky",        Schema.Boolean,   { defaultValue: () => true })
.key("StreamGap",     streamGapSchema,  …)
.key("ColdAmbiguous", coldAmbiguousSchema, …)
.key("Pick",          …)
.key("Verify",        verifySchema,     { defaultValue: () => "reject" })
.key("Conflict",      onConflictSchema, …)
.key("Yield",         yieldSchema,      …)
```

``` ts
// after — seven of these, no builder
export const Sticky = Context.Reference<boolean>("hyperlink-ts/LookupPolicy/Sticky", {
  defaultValue: () => true
})
```

Seven hand-written References is strictly less code than a builder that generates seven. With
`NodePolicy` gone, `PolicyBuilder` has one consumer left, and then none.

Composition becomes an options bag (mechanism 1) instead of a bundle algebra:

``` ts
// before — docs/guides/policy.md:25
const cutover = LookupPolicy.make({ Sticky: true, StreamGap: "stall", Verify: "reject" }).pipe(
  LookupPolicy.layer(LookupPolicy.verifyOff),
  LookupPolicy.layer(LookupPolicy.streamGap("buffer"))
)
```

``` ts
// after
const cutover = LookupPolicy.layer({
  Sticky: true,
  StreamGap: "buffer",
  Verify: false
})
```

``` ts
// before — docs/guides/client-verify.md:35
Hyperlink.client(Emails, WorkerNode).pipe(
  LookupPolicy.provide(LookupPolicy.verifyOff)
)
```

``` ts
// after
Hyperlink.client(Emails, WorkerNode).pipe(
  Layer.provideService(LookupPolicy.Verify, false)
)
```

### 6.8 The model — node, subset, layer, protocol (owner, 2026-08-21)

Supersedes the chained listen builder. That builder collapsed four concerns into one chain: address
selection, service assignment, proxying, and disposal. They separate.

```
declaration   Node.make(key).add(…)              the addresses anyone may dial
subset        Worker.http() / Worker.unix("B")   a projection of the node, same identity
service       Hyperlink.Service<J>()(id, spec, node?)
layer         Hyperlink.layer(J) / (J, impl)     client or serve, node is the requirement
protocol      NodeClient.layerProtocol* /        the choice — no address, no arguments
              NodeServer.layerProtocol*
```

#### Address

``` ts
Address.http(8080)
Address.http({ A: 9090, B: 9091 })
Address.unix("/var/run/w.sock")
Address.unix({ A: "/var/run/w.A.sock", B: "/var/run/w.B.sock" })
Address.ws("wss://edge.acme.com/rpc")
```

#### Node declaration

``` ts
class Worker extends Node.make("fleet/Worker").add(
  Address.unix("/var/run/w.sock"),
  Address.http(8080)
) {}
```

Addresses that must never be dialed by name — update sockets, cutover sides — are **not declared
here**. They are added at the layer, so an importer cannot see them.

#### Subsets

A subset is the same node with a narrowed address view. No id, no `.subset()` — identity comes from
the selection, so two subsets with the same addresses are the same subset.

``` ts
Worker.http()
// NodeSubset<Worker, "Http">

Worker.unix("B")
// NodeSubset<Worker, "IpcSocket:B">

Worker.http().unix("B")
// NodeSubset<Worker, "Http" | "IpcSocket:B">
```

``` ts
Worker.ws()
// error — Worker declares no WebSocket address
```

``` ts
Worker.unix("C")
// error — "A" | "B"
```

```
wire key      "fleet/Worker"      unchanged — one node, Directory rows keyed (nodeKey, kind)
Context key   "fleet/Worker#B"    derived from the selection
```

Precedent for the clone: `withProtocol` is already the widening direction and already re-assembles
under the same key.

``` ts
// src/internal/nodeCore.ts:908
return assembleNode<Self, ROut, MultiAddress<K | KindsOf<T>>>(node.key, {
  …
  // Same-identity derived handle keeps the base node's advertise policy.
  onConflict: node.onConflict
})
```

**Why the subset lives on the node and not the layer.** Both client and server read the same
declaration. If the protocol choice were made in the layer, the client could never know it, and a
service served only on the socket would still be dialable over http in the type. Class form:

``` ts
class Cutover extends Worker.http().unix("B") {}
```

#### Service declaration

``` ts
class Jobs extends Hyperlink.Service<Jobs>()("app/Jobs", spec, Worker.unix("B")) {}
class Mail extends Hyperlink.Service<Mail>()("app/Mail", spec) {}
```

#### `Hyperlink.layer` — one function, two modes

``` ts
Hyperlink.layer(Jobs)
// client — Layer<Jobs, never, NodeClient.Protocol<"IpcSocket">>

Hyperlink.layer(Jobs, jobsImpl)
// serve  — Layer<Jobs | Local<Jobs>, E, R | NodeServer.Protocol<"IpcSocket">>

Hyperlink.layer(Mail)
// nodeless — Layer<Mail, never, Node.Of<Mail> | NodeClient.Protocol<ProtocolKind>>
```

The second argument flips the direction of the requirement: reach the node, or be the node.

#### Protocols — const layers, no arguments

``` ts
NodeClient.layerProtocolSocket
NodeClient.layerProtocolHttp
NodeClient.layerProtocolWebsocket

NodeServer.layerProtocolSocketServer
NodeServer.layerProtocolHttpServer
NodeServer.layerProtocolWebsocketServer
```

Precedent: `RpcServer.layerProtocolSocketServer` is a const `Layer`, not a call.

**Why our own protocol service rather than RPC's directly.** In Effect RPC the address does not live
in the protocol layer — it lives one level down:

``` ts
// unstable/rpc/RpcClient.ts:1176
export const layerProtocolSocket = (options?: { … }): Layer.Layer<
  Protocol, never, Socket.Socket | RpcSerialization.RpcSerialization
>
```

``` ts
// unstable/rpc/RpcServer.ts:886
export const layerProtocolSocketServer: Layer.Layer<
  Protocol, never, RpcSerialization.RpcSerialization | SocketServer.SocketServer
>
```

Ours keeps that shape and takes the endpoint at connect time, so the layer needs no argument:

``` ts
interface Protocol<out Kind extends ProtocolKind> {
  readonly kind: Kind
  readonly connect: (endpoint: Endpoint) => Effect<RpcClient.Protocol>
}
```

#### `Node.of` — discharging an unbound node

The node is the requirement; passing an address mints one.

``` ts
Node.of(Mail, Worker)
Node.of(Mail, Address.http(8080))
```

Minting already exists, including the derived key:

``` ts
// src/internal/nodeListenCommon.ts:419
// hyperlink-ts/anonymous-node/Emails#k3f9q
// a generated key is a local, ephemeral identity — a shared identity needs an explicit key
```

#### Assembly, end to end

``` ts
// bound node, one kind — nothing to provide (see 6.11)
Hyperlink.layer(Jobs)
```

``` ts
// bound node, several kinds — client picks one
Hyperlink.layer(Jobs).pipe(
  Layer.provide(
    NodeClient.layerProtocolSocket
  )
)
```

``` ts
// serve — every declared kind must be provided
Hyperlink.layer(Jobs, jobsImpl).pipe(
  Layer.provide([
    NodeServer.layerProtocolSocketServer,
    NodeServer.layerProtocolHttpServer
  ])
)
```

``` ts
Hyperlink.layer(Jobs, jobsImpl).pipe(
  Layer.provide(
    NodeServer.layerProtocolSocketServer
  )
)
// error — NodeServer.Protocol<"Http"> unprovided
```

``` ts
// several services, one node
Layer.mergeAll(
  Hyperlink.layer(Jobs, jobsImpl),
  Hyperlink.layer(Admin, adminImpl)
).pipe(
  Layer.provide([
    NodeServer.layerProtocolSocketServer,
    NodeServer.layerProtocolHttpServer
  ])
)
```

``` ts
// nodeless, closed by the app
export const mail = Hyperlink.layer(Mail).pipe(
  Layer.provide([
    Node.of(Mail, Address.http(8080)),
    NodeClient.layerProtocolHttp
  ])
)
// Layer<Mail, never, never>
```

A requirement is discharged once, at the composition root — consumers of `mail` see nothing about
nodes, addresses, or protocols.

``` ts
// Layer.ts — Exclude<RIn2, ROut>
<RIn, E, ROut>(that: Layer<ROut, E, RIn>): <RIn2, E2, ROut2>(
  self: Layer<ROut2, E2, RIn2>
) => Layer<ROut2, E | E2, RIn | Exclude<RIn2, ROut>>
```

### 6.9 Variance is what makes one mechanism do both — `in`, not `out` (type-tested 2026-08-21)

Effect declares its services `in out`. Ours declares the kind **`in`**, and the two natural
behaviours of `R` then land exactly where they are wanted — no bending, no `serviceOption`, no
disjunction.

``` ts
interface Protocol<in Kind extends ProtocolKind> { … }
```

**This was first docked as `out` and that is wrong.** `Layer.provide` discharges via
`Exclude<RIn2, ROut>`, and `Exclude<A, B>` needs `A extends B` — the *requirement* assignable to
what is provided. Covariance gives the opposite direction, so the requirement survives:

``` ts
// covariant — does NOT discharge
Exclude<Protocol<"IpcSocket" | "Http">, Protocol<"IpcSocket">>
// = Protocol<"IpcSocket" | "Http">
```

``` ts
// contravariant — discharges
Exclude<Protocol<"IpcSocket" | "Http">, Protocol<"IpcSocket">>
// = never
```

Verified under `tsc --strict` 5.9.3 against `Layer.provide`'s real signature:

```
serve: providing one of two leaves the other        ✓ "provide all"
serve: providing both discharges                    ✓
client: exact kind discharges                       ✓
client: any one of three kinds discharges           ✓ "provide one"
client: wrong kind does not discharge               ✓
client: a WIDER provider does NOT discharge a       ← residual limitation
        narrower requirement
```

**The phantom must not be `connect`.** Contravariance needs `Kind` in an input position, and the
natural reading of that position is a claim we do not want to make — a client protocol handles
exactly one kind, not every kind in the set.

``` ts
// wrong — reads as "handles every one of these kinds"
interface Protocol<in Kind extends ProtocolKind> {
  readonly connect: (endpoint: Endpoint & { kind: Kind }) => Effect<RpcClient.Protocol>
}
```

``` ts
// right — variance from a phantom, connect stays plain
interface Protocol<in Kind extends ProtocolKind> {
  readonly [PhantomKind]: (kind: Kind) => void
  readonly connect: (endpoint: Endpoint) => Effect<RpcClient.Protocol>
}
```

**Residual limitation.** A protocol layer covering two kinds cannot satisfy a service needing one:

``` ts
Exclude<Protocol<"IpcSocket">, Protocol<"IpcSocket" | "Http">>
// = Protocol<"IpcSocket"> — not discharged
```

Each protocol layer is exactly one kind today, so this may never arise. It does mean the client
requirement reads as "one of these named kinds", not "anything that can reach this node".

```
client   R = Protocol<"IpcSocket" | "Http">          one provider satisfies it
serve    R = Protocol<"IpcSocket"> | Protocol<"Http">  each must be provided
```

``` ts
NodeClient.layerProtocolSocket
// Layer<NodeClient.Protocol<"IpcSocket">> — assignable to Protocol<"IpcSocket" | "Http">
```

``` ts
Hyperlink.layer(Jobs).pipe(
  Layer.provide(
    NodeClient.layerProtocolWebsocket
  )
)
// error — Protocol<"WebSocket"> is not assignable
```

### 6.10 Protocol defaulting and client sugar

**Default when the node has exactly one kind.** The single-address node is the common case and
should need nothing. Same mechanism as §3 — a default keeps the requirement out of `R`, and an
explicit provide overrides it the ordinary way.

``` ts
class Worker extends Node.make("fleet/Worker").add(
  Address.unix("/var/run/w.sock")
) {}
```

``` ts
Hyperlink.layer(Jobs)
// no provide — one kind, nothing to choose
```

**Transport dependencies ship inside the protocol layer**, as `protocolHttp` already does, so no one
has to satisfy a serialization or HTTP-client requirement by hand:

``` ts
// src/Hyperlink.ts:5352
RpcClient.layerProtocolHttp({ url }).pipe(
  Layer.provide(serialization),
  Layer.provide(FetchHttpClient.layer)
)
```

**Client sugar — protocol-named, address required.** Collapses the nodeless assembly to one call:

``` ts
export const mail = Hyperlink.http(Mail, 8080)
```

``` ts
// identical to
export const mail = Hyperlink.layer(Mail).pipe(
  Layer.provide([
    Node.of(Mail, Address.http(8080)),
    NodeClient.layerProtocolHttp
  ])
)
```

The second argument is typed to that protocol's address:

``` ts
Hyperlink.http(Mail, 8080)
Hyperlink.http(Mail, ":8080")
Hyperlink.http(Mail, "https://api.acme.com/rpc")
Hyperlink.ws(Mail, "wss://edge.acme.com/rpc")
Hyperlink.unix(Mail, "/var/run/mail.sock")
```

``` ts
Hyperlink.unix(Mail, 8080)
// error
```

**No serve sugar.** `Hyperlink.http(Jobs, jobsImpl)` would only typecheck when Http is the node's
sole kind, so adding one address to a node breaks serve sites that never mentioned it — a correct
error that reads as the sugar failing rather than the coverage rule firing.

``` ts
class Worker extends Node.make("fleet/Worker").add(
  Address.http(8080),
  Address.unix("/var/run/w.sock")   // one line added elsewhere
) {}
Hyperlink.http(Jobs, jobsImpl)      // now broken
```

`Hyperlink.layer(Jobs, jobsImpl)` names the actual fix — `NodeServer.Protocol<"IpcSocket">`
unprovided.

**The address argument is required on the sugar.** Without it, `Hyperlink.http(Jobs)` and
`Hyperlink.layer(Jobs)` are two spellings of one call, since 6.10's default already makes the bound
single-kind case zero-provide.

### 6.11 No arrays in our signatures — variadic, per Effect

Effect is variadic wherever it accumulates declarations, and never mixes variadic with options:

``` ts
// unstable/rpc/RpcGroup.ts
export const make = <const Rpcs extends ReadonlyArray<Rpc.Any>>(...rpcs: Rpcs)
```

``` ts
// unstable/httpapi/HttpApiGroup.ts:73
add<const A extends NonEmptyReadonlyArray<HttpApiEndpoint.Constraint>>(...endpoints: A)
```

```
RpcServer.layer(group, options?)           one thing + options
RpcServer.layerHttp({ group, path, … })    many settings → all options
HttpApi.add(...groups)                     pure accumulation
```

Ours, and where they went:

```
Node.make(key, Address | Address[], options?)      → Node.make(key).add(...addresses)
Node.unix(RouterNode, [Hyperlink.serve(…)])        → gone with the listen family
Store.Service<A>("k")(contracts)                   → Store.Service<A>()("k").add(...regs)
```

This retires the Aug-9 `Node.make` arity lock rather than breaking it — the second positional
argument existed only to avoid a chained call.

`Layer.provide`'s array overload is **Effect's** signature, not ours, so it does not conflict:

``` ts
// Layer.ts
<const Layers extends [Any, ...Array<Any>]>(that: Layers): …
```

### 6.12 Shapes considered and rejected

``` ts
// chained listen builder — collapsed four concerns into one chain; per-transport service sets
// turned out to be Agent 6's invention, not a requirement
Node.listen(Worker)
  .unix(
    Hyperlink.serve(Admin, adminImpl)
  )
  .http(
    Hyperlink.serve(Jobs, jobsImpl)
  )
```

``` ts
// argument-less selector methods — a selector with nothing to select for
Node.listen(Worker).unix().http()
```

``` ts
// an extra registry provide on top of the transports
Layer.mergeAll(…).pipe(
  Layer.provide(
    Node.layer(Worker)
  )
)
```

``` ts
// one call keyed by address — arrays are structural and cannot go variadic inside an object
Node.layer(Worker, { unix: [ … ], http: [ … ] })
```

``` ts
// service-first — per-service address lists must be edited in N places to change one process
Hyperlink.serve(Jobs, jobsImpl).pipe(
  Node.on(Worker, "unix", "http")
)
```

``` ts
// topology in the declaration — recreates superset-then-filter with services included, so a second
// process cannot differ without a knob
class Worker extends Node.make("fleet/Worker").add(
  Node.endpoint("unix", Address.unix("…")).add(Admin).add(Jobs)
) {}
```

``` ts
// label methods on the builder — forces the label space to exclude every builder method and every
// Object.prototype key, and that restriction leaks into the declaration
Node.listen(Worker).public(…)
```

``` ts
// a named subset id — the selection is already the identity
MyNode.subset("subNode").http()
```

``` ts
// renamed protocol wrappers — the same thing with a worse name
Hyperlink.protocolIpc(Jobs)
```

Also rejected: address→address `proxy(subject, { to })`, per-address exhaustiveness with `.off`,
pools as a disposition, and reach tiers (5.5.6).

### 6.13 What deletes, what is added

```
deletes
  PolicyBuilder public + internal                    2 files
  NodePolicy                                         whole module
  LookupPolicy.make / Policy / Config / Fragment     bundle types
  LookupPolicy.MergeConfigs / MergePolicyList
  LookupPolicy.config / provide                      → Layer.provideService
  per-key camelCase fragments + presets              verifyOff, verifyStatus, verifyReject,
                                                     sticky, unsticky, …
  onConflict three-way precedence                    nodeCore.ts:538, :849, :921
  NodePolicyConfigKey stamp + nodePolicyOf           with its test
  Node.Service + nine inline-target overloads        §1.5
  Node.listen / unix / http / ws / nPipe             the listen family, ~20 hand-synced overloads
  Node.listenLocal
  Node.httpServer / wsServer / ipcServer
  Hyperlink.serve                                    → Hyperlink.layer(tag, impl)
  ProtocolKindMismatch                               becomes unreachable — the subset decides
  ListenUseProtocol                                  the spine/sibling split is now the type

adds
  Node subsets — Worker.http() / Worker.unix("B")
  Hyperlink.layer(tag) / (tag, impl)
  NodeClient.layerProtocol* / NodeServer.layerProtocol*   const layers, no arguments
  Node.of(tag, node | address)
  Hyperlink.http|ws|unix|nPipe(tag, address)              client sugar, address required
  .annotate(Reference, value) on declarations             HttpApi already has it
  LookupPolicy.layer(options)                             RpcServer.layer shape
```

### 6.14 Accepted costs

1. `LookupPolicy.verifyOff` reads better than `Layer.provideService(LookupPolicy.Verify, false)`, and
   the presets go. Effect eats the same cost — `References.ts` ships 14 bare References and adds a
   `with*` combinator only where one earns it.
2. `.annotate` is unchecked by scope. `ClusterSchema` and `HttpApi` annotations are equally
   unchecked. **Explicitly not fixing this** — a scope brand would be our own machinery on top of
   Effect's, which is how `PolicyBuilder` happened.
3. A nodeless service loses the protocol check: `Protocol<Allowed>` opens to `ProtocolKind`, so
   picking a protocol the provided address cannot serve fails at build rather than at compile time.
4. Changing a subset's selection re-brands it, so a service bound to `Worker.unix("B")` and one bound
   to `Worker.unix("B").http()` are unrelated types. Tolerable inline; sharper if subsets become
   shared consts across files.

### 6.15 Problems still to solve

1. **Stable address across a process swap.** Owner: *"It has to be stable."* Claims already exist —
   `Identity` is "exclusive HyperService key claims (first wins; dead winners replaceable)" — and
   `Hyperlink.ts:4342` claims `{ key, nodeKey, kind, url?, path? }`. Open: whether the socket is
   what stays fixed (needs `SO_REUSEPORT` or a bind gap) or the identity is (dialers re-resolve).
   Proxy was the answer to the first; it is currently un-replaced.
2. **A Lookup node on every machine.** Owner wants one per machine so an intra-machine dial never
   leaves the box. `Address.unixFromKey` already derives a socket path from the node key with no
   round trip — how much of this is already covered, and what the per-machine Lookup adds.
3. **Where LookupPolicy References attach** — node declaration, service declaration, or ambient.
   Effect uses all three placements, so precedent does not decide it.
4. **Advertise must group by protocol.** `nodeServerCommon.ts:123` and `:158` put every served key
   into one row under `advertiseNode.kind`. The row schema already supports subsets —
   `DirectoryEntry` is keyed `(nodeKey, kind)` with its own `serves` — so the producer needs to group
   rather than flatten.
5. ~~**`Protocol<Kind>` variance in practice.**~~ Closed — type-tested, see 6.9. It is `in`, not
   `out`, the phantom must not be `connect`, and a wider provider cannot satisfy a narrower
   requirement.
6. **Migration of unlabeled multiples.** 6.6 makes a label required once a protocol repeats.
7. **`NodeMakeDef` must brand `Self` from `Key`** (§1.5) before `Node.Service` can be deleted.
8. **`Store.Service` drift** (§1.6) — arity, `.add`, and the lost key literal.
9. **`dialIdentity` keys on input shape, not socket** (5.5.6, survivor 1) — independent defect.
10. **Names.** `Node.of`, `NodeClient` / `NodeServer`, `Node.Of<S>`, `NodeSubset`, and whether the
    server protocol layers keep Effect's `…SocketServer` suffix.

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
| 5 | Configuration rework (§6) — presence + References, listen builder | designed, 9 open (§6.13) |

**Landable independently of everything above**, in dependency order:

| # | Change | Blocks |
|---|--------|--------|
| a | `dialIdentity` normalises to a socket identity (5.5.6) | nothing — plain defect |
| b | `NodeMakeDef` brands `Self` from `Key` (§1.5) | c |
| c | Delete `Node.Service` + its nine inline-target overloads | — |
| d | `Store.Service` arity, `.add`, key literal (§1.6) | — |

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

### 8.10b Layer API — flat `layer*`, never a chained builder (owner, 2026-08-19)

Effect has no `.build()`. Every module exposes **free `layer*` functions taking the contract**, with
options bags, composed via `Layer.provide`:

``` ts
// RpcServer.ts:768
export const layer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: {
    readonly disableTracing?: boolean | undefined
    readonly spanPrefix?: string | undefined
    readonly concurrency?: number | "unbounded" | undefined
    readonly disableFatalDefects?: boolean | undefined
  }
): Layer.Layer<never, never, Protocol | …>
```

``` ts
// RpcServer.ts:797 — transport variants are sibling layers, not chain steps
export const layerHttp = <Rpcs extends Rpc.Any>(options: {
  readonly group: RpcGroup.RpcGroup<Rpcs>
  readonly path: HttpRouter.PathInput
  readonly protocol?: "http" | "websocket" | undefined
  …
})
```

``` ts
export const layerProtocolSocketServer: Layer.Layer<Protocol, …>
export const layerProtocolWebsocket = (options: { … })
export const layerProtocolHttp = (options: { … })
```

Applied — and consistent with *Layers read as layers* in the naming standard:

``` ts
WorkPool.layer(jobs, {
  concurrency: 4,
})
```

``` ts
WorkPool.layerListen(jobs, options?)
```

``` ts
const jobsLayer = WorkPool.layer(jobs).pipe(
  Layer.provide(jobsLocal),
  Layer.provide(protocolLayer),
)
```

**Rejected:** `WorkPool.build(jobs).listen()` and `Hyperlink.build(…)` — both invented, no precedent.

### 8.10c The implementation is a plain object keyed by lane

Lanes are members, so implementing a pool is implementing an object — no builder, no callback:

``` ts
const jobsLocal = Layer.succeed(jobs, {
  urgent: (job) => process(job),
  batch: (job) => crunch(job),
})
```

``` ts
const jobsLocal = Layer.effect(
  jobs,
  Effect.gen(function* () {
    const limiter = yield* RateLimiter

    return {
      urgent: (job) => process(job),
      batch: (job) => limiter(crunch(job)),
    }
  })
)
```

### 8.10d `success` means the handler's output

**Decision: `success` keeps its library-wide meaning.**

``` ts
Rpc.make("GetUser", { success: User })                        // handler's output
HttpApiEndpoint.get("getUser", "/u/:id", { success: User })   // handler's output
WorkPool.lane("urgent", { success: Result })                  // handler's output
```

Enqueue therefore does **not** return `success` — it returns a receipt:

``` ts
const urgent = WorkPool.lane("urgent", {
  payload: UrgentJob,
  success: Result,
  error: Rejected,
})
```

``` ts
{
  readonly urgent: (job: UrgentJob) => Effect<Receipt<Result, Rejected>, SchemaError, Protocol>
}
```

**Rejected:** making the call itself wait. A pool exists to decouple; blocking enqueue has no answer
for batches or deferred lanes:

``` ts
yield* jobs.urgent([jobA, jobB, jobC])   // one Result? an array? when?
WorkPool.lane("batch", { defer: Duration.hours(6) })   // a six-hour call is not a call
```

### 8.10e Receipt — self-routing, phantom-typed

The receipt carries the canonical key, so combinators need no pool argument, and carries the result
types phantomly, so nothing is lost:

``` ts
export interface Receipt<out Success = unknown, out Error = never> {
  readonly key: string
  readonly lane: string
  readonly id: string
  readonly "~Success": Success
  readonly "~Error": Error
}
```

``` ts
// runtime — three strings; key is the one minted in §4.5.2
{
  key: "hyperlink-ts/WorkPool/HyperService/jobs",
  lane: "urgent",
  id: "01JD8…",
}
```

``` ts
export const receipt = Schema.Struct({
  key: Schema.String,
  lane: Schema.String,
  id: Schema.String,
})
```

Phantom-member casing follows *A phantom member is named after what it mirrors*
([`types-and-naming.md`](../standards/types-and-naming.md)) — these mirror the `Success` / `Error`
type parameters, so they take those names:

``` ts
// HttpApiEndpoint.ts — same slots, same casing
readonly "~Params": Params
readonly "~Success": Success
readonly "~Error": Error
readonly "~Middleware": Middleware
```

Constructing one needs the sanctioned boundary cast — owner confirmed this class of cast is fine,
and *A boundary cast is a last resort* already permits it (no runtime value to validate):

``` ts
// SAFE: `~Success` / `~Error` are phantom type carriers with no runtime representation;
// the wire value is exactly { key, lane, id }. Nothing to validate.
return { key, lane, id } as Receipt<S, E>
```

### 8.10f Reaching the result — dual pipe combinators

**Decision: pipe, not a callback and not a second calling convention.**

``` ts
export const result: {
  <S, E, EX, R>(self: Effect<Receipt<S, E>, EX, R>): Effect<S, E | EX | Rejected, R | Protocol>
  <S, E>(receipt: Receipt<S, E>): Effect<S, E | Rejected, Protocol>
}
```

``` ts
jobs.urgent(job).pipe(
  WorkPool.result
)
```

``` ts
jobs.urgent(job).pipe(
  WorkPool.resultWithin(Duration.seconds(30))
)
```

``` ts
jobs.urgent(job).pipe(
  WorkPool.peek
)
// Effect<Option<Result>, SchemaError, Protocol>
```

``` ts
jobs.urgent([jobA, jobB, jobC]).pipe(
  WorkPool.resultAll
)
```

Composes with plain Effect, which a callback could not:

``` ts
jobs.urgent(job).pipe(
  WorkPool.result,
  Effect.timeout(Duration.seconds(30)),
  Effect.retry(Schedule.exponential(Duration.millis(100))),
  Effect.tap((r) => Effect.logInfo(`done ${r.id}`)),
)
```

Precedent — `Workflow` solves submit-now / redeem-later with a flag plus a poll, and returns
`Option` for "still running":

``` ts
// Workflow.ts:80
readonly execute: <const Discard extends boolean = false>(
  payload: Payload["~type.make.in"],
  options?: { readonly discard?: Discard }
) => Effect.Effect<
  Discard extends true ? string : Success["Type"],
  Discard extends true ? never  : Error["Type"],
  WorkflowEngine | …
>
```

``` ts
// Workflow.ts:97
readonly poll: (
  executionId: string
) => Effect.Effect<Option.Option<Result<Success["Type"], Error["Type"]>>, never, WorkflowEngine | …>
```

We invert the default — Workflow waits because a workflow *is* the call; a pool does not.

**Rejected:** `jobs.urgent.await(job)` (callable namespace) and `{ onComplete }` (no Effect
precedent, and no fiber to run the callback on once the enqueuer is gone).

### 8.10g Untyped receipts

A receipt arriving as untrusted JSON has no types until a lane is named — the one place the
contract reappears, correctly:

``` ts
const r = yield* Schema.decodeUnknown(WorkPool.receiptFor(Jobs, "urgent"))(raw)
// Receipt<Result, Rejected>
```

### 8.11 Still open

1. ~~What `success` means on a lane~~ — **settled in §8.10d**: the handler's output. Enqueue returns
   a `Receipt`; the result is reached with `WorkPool.result`.
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

## 9. Open questions (older, still unresolved)

1. Does the default-client Reference need a no-default alternative, or is `.make` enough?
2. How does a requirement type carry N addresses without R becoming combinatorial?
3. What exactly does `.make` return — class or value — and does it keep `class X extends` form?

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
