{#no-casts title="No casts / structural typing" order=40 appliesTo=src}
# No casts / structural typing

Types are load-bearing here. A cast is a place the compiler stops checking — so the rule is to make
the types true, not to assert around them. This bar is deliberately higher than Effect's own
internals; it is a project rule, not an inherited one.

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
  add: Resource.effectFn(item),
} satisfies Resource.Spec

// ✅ good — the helper checks and preserves it; correct by construction, shareable
const spec = Resource.contract({
  add: Resource.effectFn(item),
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
