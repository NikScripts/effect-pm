{#agent-06-service-make-address title="Agent 6 — .Service / .make split + Address-as-requirement" status="draft" appliesTo=src}
# Agent 6 — `.Service` / `.make` split + Address-as-requirement

**Owner game plan, captured 2026-08-17. Nothing here is Eng'd.**
Owner gate: **do not implement the Address requirement work without the owner.**

## 1. Two constructors, one contract

`.Service` **stays as is** — the class handle, yieldable. Its constructor may gain changes;
the class handle itself does not change.

`.make` is (re)introduced, following HttpApi / HttpApiClient "kinda". It returns a class or
value — not a service. Two different results from the same family:

| Constructor | Result | Yieldable | Passable to layer builder | Passable to client helpers |
|-------------|--------|-----------|---------------------------|----------------------------|
| `.Service`  | service (Context identity) | **yes** | yes | yes |
| `.make`     | class / value (no identity) | no | yes | yes |

**Interchangeability is the requirement.** The service and the non-service class/const are
interchangeable for the most part: the same methods and helpers accept both. The service class
carries the same pieces the non-service class carries, so it can go to the layer builder *and*
to the client helpers. The only real difference: **you can only yield one of them.**

## 2. Helpers

Helpers are `Hyperlink.something` — not a separate module.

Requirement differs by input:

- client built from a **helper** → requirement is **just the protocol**
- client built from the **Service** → requires **that service**, which may be the real thing
  or just a client layer

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
| 2 | Play with the APIs — push `.Service` / `.make` / helpers toward HttpApi shape | **next** |
| 3 | Lock the desired API shape — provisional, explicitly **not final** | after 2 |
| 4 | Node/Address as a requirement (§5) — the #1 priority | owner-gated, after 3 |

Rationale: step 3 gives a full picture of everything else in motion before step 4 starts. Nothing
in steps 2–3 is binding; the address model may invalidate any of it.

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
