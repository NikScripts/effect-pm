{#types-and-naming title="Types & Naming" order=30 appliesTo=src}
# Types & Naming

The type-level rules: making types true instead of asserting them, how everything is named, and how public shapes are declared.

{#fix-root-cause .must appliesTo=src}
## No casts — fix the root cause structurally

No `as`, `as any`, `as unknown`, or `!` non-null assertions. When a type doesn't fit, change the
type — restructure the value, the signature, or the generic — until it does. A cast that "makes the
error go away" is a silent hole; the error was telling the truth.

``` ts
// ❌ bad — asserts the shape into existence
const cfg = input as QueueConfig

// ✅ good — the type is earned
const cfg = makeQueueConfig(payload, options)
```

{#narrow-with-validation .must appliesTo=src}
## Narrow with runtime validation, never an assertion

When a value arrives as `unknown` (wire input, config, JSON), narrow it by *checking* it — a
`Schema` decode or a type predicate — never by asserting. If a runtime value exists, it must be
validated, not assumed.

``` ts
// ❌ bad — unchecked; a malformed payload sails straight through
const item = raw as WorkItem

// ✅ good — validated; a bad payload fails loudly, typed
const item = yield* Schema.decodeUnknown(WorkItem)(raw)
```

{#correct-by-construction .must appliesTo=src}
## Correct by construction — no `as`, no `satisfies`

A value's type comes from a typed constructor, decoder, or contract helper — never from an
annotation bolted on afterward. Reaching for `satisfies` (like `as`) means the value was divorced
from the API that should have typed it; the fix is a stricter API, not a stricter annotation. The
contract helpers exist for exactly this: `Resource.contract` / `Store.contract` are
`<const S extends Spec>(s: S) => S` — the constraint checks the shape, `const` preserves the exact
type, so the contract is correct by construction and shareable. Use them; never pin a literal.

``` ts
// ❌ bad — a literal pinned with satisfies, divorced from any API
const spec = {
  add: Resource.effectFn(Schema.Void, { payload: item }),
} satisfies Resource.Spec

// ✅ good — the helper checks and preserves it; correct by construction, shareable
const spec = Resource.contract({
  add: Resource.effectFn(Schema.Void, { payload: item }),
})
```

`as const` is unaffected — it's literal narrowing, not validation, and is always fine.

{#boundary-cast-last-resort .must appliesTo=src}
## A boundary cast is a last resort — provably safe and justified

A cast is permitted **only** at the type-level boundary where TS genuinely cannot express a relation
*and* there is no runtime value to validate (pure HKT/builder erasure). Every such cast must be
**provably safe by construction** and carry a one-line comment stating *why* it holds. No bare
casts, no "it works" — the proof is the price of the cast. If a runtime value is in reach, this rule
does not apply; you validate instead of assert.

``` ts
// ✅ the only sanctioned form: provably safe, justified, no runtime value to check
// SAFE: `acc` is assembled field-by-field to satisfy Built<Self> across the chain below;
// TS can't track the accumulation through the builder. Nothing to validate at runtime.
return acc as Built<Self>
```

{#honest-error-types .must appliesTo=src}
## Type writes and failures honestly — never cast to `never`

An error channel is part of the type. Never widen a real failure away with `as never` or a `never`
return. A write that can fail is `Effect<…, StoreWriteError>`; casting it to `Effect<…, never>` is a
lie the caller pays for.

``` ts
// ❌ bad — claims it can't fail
append(row): Effect<void, never>

// ✅ good — the failure is typed and catchable
append(row): Effect<void, StoreWriteError>
```

{#extract-r-structurally .must appliesTo=src}
## Extract requirements structurally

Union a heterogeneous `R` by reading it off the implementation (`ServeRequirements<Impl>`), never by erasing
it. Never `as ServeEntry<never>`, never pin different entries to one `R`, never erase a precise
group type (`RpcGroupOf<S>`) down to `RpcGroup<any>` for assignability — that is the un-typed move
that hides a real mismatch.

{#classify-by-field-not-brand .must appliesTo=src}
## Classify by a structural field, never a brand

Detect leaf-vs-group (and kind generally) with a narrow, `F`-independent structural check — a `kind`
field — never a symbol brand or `extends AnyMethod`. No type-level branding.

``` ts
// ❌ bad — symbol brand / F-dependent test
if (node[groupSym]) { /* … */ }

// ✅ good — a plain structural discriminant
if (node.kind === "group") { /* … */ }
```


{#pascalcase-types-only .must appliesTo=src}
## PascalCase only for types, classes, and namespaces

PascalCase names a class, a type, a namespace, or a namespace-member factory (`Tag`, `Service`,
`Schedule`). Nothing else. If it's a value you can pass around, it is not PascalCase — the sole
exception is a factory that stands in for a namespace member.

{#values-are-camelcase .must appliesTo=src}
## Values are camelCase; UPPER_SNAKE only for magic constants

Every value is camelCase: layers, schemas, symbol consts, and ordinary module constants and
defaults. Reserve `UPPER_SNAKE_CASE` for the narrow set of fixed *magic* values Effect itself uses
it for — external-protocol codes, regex/pattern literals, spec URIs, and low-level algorithmic magic
numbers. A tunable default is a value, not a magic constant.

``` ts
// ❌ bad — an ordinary default is just a value
export const DEFAULT_POLL_MS = 5_000
// ✅ good
export const defaultPollMs = 5_000

// ✅ fine — a fixed protocol code / pattern is genuinely magic; UPPER_SNAKE, as Effect does
const PARSE_ERROR_CODE = -32700
const STRING_PATTERN = /^[a-z]+$/
```

{#schema-value-vs-class .must appliesTo=src}
## A schema value is camelCase; a schema class is PascalCase

A schema comes in two forms, and both honor the type/value split:

- A schema bound to a const (`Schema.Struct`, `Schema.Union`, …) is a **value** → camelCase; derive
  a PascalCase type alias when you need the type.
- A `Schema.Class` **is a class** → PascalCase, and it is value and type in one, so no separate
  alias.

``` ts
// value schema — camelCase value, PascalCase type derived from it
export const workItem = Schema.Struct({ id: Schema.String })
export type WorkItem = typeof workItem.Type

// class schema — PascalCase class, value + type in one
export class WorkItem extends Schema.Class<WorkItem>("WorkItem")({
  id: Schema.String,
}) {}
```

Both drop into any config that takes a schema — `payload` / `success` / `error` accept any
`Schema.Top`.

{#prefer-schema-class .should appliesTo=src}
## Prefer a class schema when it earns its keep

Reach for a `Schema.Class` when a schema is **named, reused, carries behaviour, or wants a nominal
identity** — a payload, a response, a domain entity, an error. You get one name for the value and
the type, a validating constructor (`new WorkItem({…})`), `instanceof`, and room for methods. Keep a
plain struct value for **inline or anonymous** shapes, where a class is just ceremony.

{#layers-read-as-layers .should appliesTo=src}
## Layers read as layers

Layers are camelCase. The canonical toolkit entrypoint is `layer` (and `layer*` variants like
`layerMemory`); a composed or auxiliary layer takes a `*Layer` suffix (`persistLayer`, `peersLayer`).
Either way the name says "layer."

{#discriminant-tags-pascalcase .must appliesTo=src}
## Discriminant tags are PascalCase

A tagged-union `_tag` value is PascalCase: `Started`, `Completed`, `Failed`, `Interrupted` — never
kebab (`run-started`) or a `Run*`-style prefix. The tag names the case; it reads like the variant it
is.

{#canonical-ids-slash-scoped .must appliesTo=src}
## Canonical ids are slash-scoped

A service or contract id is a slash-separated, package-scoped string with PascalCase segments:
`@nikscripts/effect-pm/QueueResource`, `@nikscripts/effect-pm/ApiMetrics/clientId`. (CLI and remote
surfaces additionally accept normalized kebab suffix aliases; an ambiguous suffix errors with the
candidate list.)

{#name-for-what-it-is .must appliesTo=src}
## Name for what a thing is, not who uses it

A name describes the thing's own role, never a consumer's vocabulary. The package surface names
*serving* — it never borrows a downstream app's domain word (a queue is a `QueueResource`, not a
`SourceQueue` because one caller calls it a "source").


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
