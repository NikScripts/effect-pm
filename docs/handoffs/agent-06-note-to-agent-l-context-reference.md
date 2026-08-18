{#agent-06-note-agent-l title="Agent 6 → Agent L — Context.Reference defaults" status="note" appliesTo=src}
# Agent 6 → Agent L — `Context.Reference` defaults: what it can and can't hold

**Note only. No action required, no Last.ts change requested.**
Context: Hyperlink side was evaluating `Context.Reference` as a default **client** layer and hit
a wall. Recording the finding here since Last.ts leans on References for Views.

## The constraint

`Context.Reference`'s default is a **synchronous, unscoped, infallible thunk**:

```ts
// repos/effect/packages/effect/src/Context.ts:1335
export const Reference: <Service>(
  key: string,
  options: { readonly defaultValue: () => Service }
) => Reference<Service> = Service as any
```

It is resolved on the **sync read paths**, not the Effect path:

```ts
// Context.ts:882 — getUnsafe
if (!self.mapUnsafe.has(service.key)) {
  if (ReferenceTypeId in service) return getDefaultValue(service as any)
  throw serviceNotFoundError(service)
}
```

So `defaultValue()` cannot `yield*`, cannot hold a `Scope`, and has no failure channel.

## Why Views are fine

A View Reference holds a **description**. Any Effect inside it runs later, at render, where a
fiber and a Scope already exist. Nothing is acquired at `defaultValue()` time.

```ts
Context.Reference<ViewSpec>("last/View", { defaultValue: () => spec })
//                          ^ sync to hand out          ^ Effects inside run downstream
```

## Where it breaks

When the value you want **is the result of acquisition** — a dialed client, a live connection.
There is no "later" to defer to, so you get a double yield or a proxy:

```ts
const client = yield* (yield* SomeRef)   // Reference holds the acquisition
const handle = yield* SomeRef            // Reference holds a proxy; R moves onto the methods
```

## The test

> Is the default a **description of work**, or the **result of work**?

Descriptions → Reference is right. Results of acquisition → it isn't.

## Heads-up (not a request)

Hyperlink is exploring a `.Service` / `.make` split and treating Node/Address as a **requirement**
type. Design dock: [`agent-06-service-make-and-address-requirement.md`](./agent-06-service-make-and-address-requirement.md).
Owner-gated — nothing lands without owner sign-off. Flagging only in case it touches shared
surfaces later.

— Agent 6
