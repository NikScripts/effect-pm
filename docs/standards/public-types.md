{#public-types title="Public types & service definition" order=60 appliesTo=src}
# Public types & service definition

The types and constructs a consumer touches: the shapes they pass and receive, and the way a
service is declared. Two shapes of thing, three rules.

{#api-shapes-are-interfaces .must appliesTo=src}
## Public API shapes are hand-written `export interface`

An **API shape** is anything a consumer programs *against* — the object you pass in
(`ProcessMakeOptions`, `AcceleratingPollConfig`), the object you get back (`ProcessSnapshot`,
`HistoryStoreShape`), an options bag (`QueryOpts`), a service's method set. These are hand-written
`export interface`.

Why an interface, specifically:

- **It reads cleanly on hover.** An interface shows a consumer named fields; a schema-derived alias
  expands into `Schema.Struct<{…}>` machinery and buries the shape.
- **It's stable and documentable.** Each field takes a doc comment; the type is a fixed anchor, not
  a byproduct of whatever a schema currently infers.
- **It doesn't leak internals.** A `typeof schema.Type` drags the schema's encoding details into
  the public surface; an interface exposes only the contract.

``` ts
// ✅ good — explicit, documented, hover-friendly
export interface ProcessMakeOptions<E, RUser> {
  /** Poll cadence while the schedule is armed. */
  readonly polling?: PollingLayer
  readonly success?: Schema.Top
}

// ❌ bad — an API shape fabricated from a schema's inferred type
export type ProcessMakeOptions = typeof processMakeOptionsSchema.Type
```

A **sum type** is the one exception to "interface": a discriminated union is written `export type X
= A | B` over variant interfaces — still a hand-written contract, not a derived alias, and correct.
What this rule forbids is narrower — a schema-derived `typeof …Type` standing in for an API surface.

``` ts
// ✅ good — a sum type is a union of variant interfaces (as Option.Option is None | Some)
export type Connection = Connected | Disconnected
export interface Connected { readonly _tag: "Connected" }
export interface Disconnected { readonly _tag: "Disconnected"; readonly reason: string }
```

{.note}
This holds right up to the framework's own primitives: Effect's `Layer`, `Queue`, and `Cache` are
each `export interface`, and `Option` is an `export type` union of `Some` and `None` — never derived
types.

{#schema-data-derives .must appliesTo=src}
## Schema-backed data derives its type from the schema

The counterpart — and the one place `typeof …Type` is *correct*. **Data** whose single source of
truth is a schema (events, payloads, wire records, metrics — anything encoded, decoded, or validated
by a `Schema`) takes its type *from* that schema. The schema already defines the shape for the wire;
hand-writing a parallel interface would duplicate it and break single-source-of-truth.

The heuristic to tell the two apart:

{.note}
**Is there already a `Schema` that defines this shape for validation or the wire?** If yes, it's
schema-backed data — derive the type. If no, it's a pure call contract — hand-write the interface.

``` ts
// ✅ good — the schema is the SSOT; the type derives from it
export const apiUsageMetrics = Schema.Struct({ /* … */ })
export type ApiUsageMetrics = typeof apiUsageMetrics.Type

// ✅ also good — a Schema.Class gives the named type directly (see Naming)
export class ApiUsageMetrics extends Schema.Class<ApiUsageMetrics>("ApiUsageMetrics")({ /* … */ }) {}
```

Keep such aliases rare: Effect exposes a schema's type through its `.Type` member at the use site
rather than proliferating standalone aliases — derive where you need it, don't mint a name for every
shape.

{#services-use-class-extends .must appliesTo=src}
## Services, tags, and facets use the class-extends form

A service, resource tag, or storage facet is declared by extending the framework factory *in a
class* — never a bare factory call bound to a const. This is the **only** sanctioned `class extends`
in the codebase (see *Principles → Composition over inheritance*): you are not inheriting behaviour,
you are giving the service a **nominal identity**. The `<Self>` self-reference is what supplies it —
the class names itself as its own type.

``` ts
// core service — Context.Service<Self, Shape>, the Shape usually its own interface
export interface DurableQueueStoreShape { /* … */ }
class DurableQueueStore extends Context.Service<DurableQueueStore, DurableQueueStoreShape>()(
  "@nikscripts/effect-pm/DurableQueueStore",
) {}

// resource tag — X.Tag
class Prices extends Process.Tag<Prices>()("app/Prices", { success: priceSchema }) {}

// storage facet — X.Store.Service
class LogStore extends ProcessStore.Service<LogStore>()(id, record, read) {}
```

``` ts
// ❌ bad — bare factory bound to a const: no self-type, no nominal identity
const durableQueueStore = Context.Service(id, shape)
```

{.note}
Effect declares its services the same way — `class CurrentTimeZone extends
Context.Service<CurrentTimeZone, TimeZone>()(key)` — the self-reference is the identity.

Two facts live elsewhere so each stays in one place: **ids** are slash-scoped (*Naming*), and
**associated type helpers** attach via `export declare namespace` (*Module layout*).
