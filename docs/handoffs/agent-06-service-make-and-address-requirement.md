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

## 3. Default client — `Context.Reference` ruled out (2026-08-18)

**Outcome: the zero-provide default client is not achievable. The default *layer* still is.**

### What was tried and why each failed

| Approach | Verdict |
|----------|---------|
| `Context.Reference` default | **No.** `defaultValue: () => Service` is sync, unscoped, infallible — it cannot dial, cannot hold a `Scope`, cannot fail |
| Reference holding the acquisition Effect | **No.** Forces a double yield: `yield* (yield* Ref)` |
| Reference holding a lazy proxy | **Rejected by owner.** `R` disappears from acquisition and reappears per method |
| Custom class overriding `Effectable` `evaluate` | **No.** Context's default path lives in the *sync* readers (`getUnsafe`, `getOrElse`), so every direct `Context.get` on the tag would throw instead of falling back |
| Effect-provides-dependency wrapper | **No.** Provision covers what an effect *runs*, not an Effect it *returns* — a returned Effect keeps its requirement in the success type |

Source of the constraint:

```ts
// Context.ts:1335 — sync thunk, no Effect, no Scope, no error channel
export const Reference: <Service>(
  key: string,
  options: { readonly defaultValue: () => Service }
) => Reference<Service>

// Context.ts:882 — the default is resolved on the sync read path
if (!self.mapUnsafe.has(service.key)) {
  if (ReferenceTypeId in service) return getDefaultValue(service as any)
  throw serviceNotFoundError(service)
}
```

### What survives

A **default client layer**, provided once where the runtime is assembled:

```ts
Layer.provide(app, Hyperlink.clientLayer(Jobs))   // effectful + scoped, no Reference needed
Effect.provideService(program, Jobs, realImpl)    // override is still a plain provide
```

Cost vs. the original plan: **one provide at app assembly**. Everything else the plan wanted is
intact — one handle everywhere, override by simple provide, protocol as the only leftover
requirement. `.make` remains the no-client path.

**Open:** owner has not decided whether to adopt the one-provide default layer or drop the
default-client idea entirely.

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
