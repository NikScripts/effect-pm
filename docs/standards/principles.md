{#principles title="Principles" order=10 appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/principles>.
<!-- docs-site-link:end -->
# Principles

How we write code here, and how we shape the system. Every concrete rule downstream enforces one of
these — when a rule and a principle conflict, the principle wins and the rule is wrong. The
mechanical chapters state the *how*; this chapter is the *why* they point back to. It runs from the
most general stance to the most specific technique.

{#composition-over-inheritance .must appliesTo="src examples"}
## Composition over inheritance

Behavior is built by composing small values, layers, and combinators — never by class hierarchies
for logic reuse. The only `class extends` in the codebase is the `Service` / `Tag` factory form (a
construction shape, not an OO hierarchy); nothing subclasses to *inherit behavior*. Need a
variation? Compose a combinator or provide a different layer — never reach for a base class.

``` ts
// ❌ bad — subclass to add behavior
class LoggingStore extends MemoryStore { /* override append… */ }

// ✅ good — compose the behavior onto the value
const store = memoryStore.pipe(Store.mapEffects(withLogging))
```

{#handles-stay-thin .must appliesTo="src examples"}
## Handles stay thin; ship helpers separately

A handle (Tag, kit, service class, compose result) carries only what cannot be refactored out:
identity, contract, and the surface the type system must attach there. If something can be a free
function or an `Effect`, extract it and ship it as a helper. Do not hang derived menus, observe
doors, or convenience nouns on the handle to make call sites shorter.

``` ts
// ❌ bad — weight on the handle / kit
Jobs.observe()
ui.data.queue(Jobs)

// ✅ good — thin handle; Observe + *View.pack owns the derived surface
import * as Observe from "hyperlink-ts/Observe"
import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
Observe.use(Jobs, WorkPoolView.pack)
// migration: Bundle.observe(Jobs) still works
```

The test: if removing the method leaves a complete Tag (or kit) and a named helper that takes that
handle as data, the method did not belong on the handle. See [Observe](/docs/observe) and
[Bundles](/docs/bundles).

{#single-source-of-truth .must appliesTo="all docs"}
## Single source of truth

Each fact lives in exactly one place; everything else derives from it. Never store the same truth
twice — the copy always drifts. The Tag is the one home for a wire schema; the dead-letter budget is
read from `attempts`; the worker outcome is recorded once. If you're about to write a fact down a
second time, derive it instead.

``` ts
// ❌ bad — `remaining` is a second copy of the same fact; it will drift
const entry = { attempts, remaining: maxAttempts - attempts }

// ✅ good — one fact stored, the rest derived
const remaining = (e: Entry) => maxAttempts - e.attempts
```

{#dont-fight-the-framework .must appliesTo="src examples"}
## Don't fight the framework

Compose *with* Effect, never around it. Behavior is added as post-construction combinators
(`Hyperlink.withReadiness`), not baked constructor options or plugin arrays. Dependencies flow
through `Layer.provide` — a `Layer` is never passed as config *data*. When the framework already has
a shape for something, use that shape.

``` ts
// ❌ bad — a Layer smuggled in as data
make({ dependencies: [DbLayer] })

// ✅ good — provided through the layer graph
make(config).pipe(Effect.provide(DbLayer))
```

{#lean-into-functional-effect .must appliesTo="src examples"}
## Lean into functional Effect

Use Effect's vocabulary instead of re-implementing control flow: `map` / `flatMap` / `zip` /
`forEach` / `catch*` over hand-rolled loops and try/catch. Let the effect channel carry errors and
requirements; let immutability be the default. The framework already solved control flow — spend
your effort on the domain.

``` ts
// ❌ bad — manual loop + accumulator
const out = []
for (const id of ids) out.push(yield* fetch(id))

// ✅ good — one combinator
const out = yield* Effect.forEach(ids, fetch)
```

{#dont-reinvent-dont-preabstract .must appliesTo="src examples"}
## Don't reinvent, don't pre-abstract

Reuse what exists before building; build one concrete thing before generalizing. Metrics are
standard Effect `Metric`; retention and alerting are OTEL/Grafana's job — we don't rebuild them. A
new capability reuses an existing seam rather than adding a parallel alias. And a shared helper is
extracted only once the shape has provably repeated — one hand-built instance first, abstraction
second.

{#effects-are-descriptions .must appliesTo="src examples"}
## Effects are descriptions — no eager side effects

An `Effect` is a *description* of work, run at the edge of the program — not something that fires
when constructed. No raw `async` / `Promise`, no side effects in constructors, and no ambient
globals: time comes from `Clock`, randomness from `Random`, HTTP from `HttpClient`. (This is why the
lint bans `Date.now`, `Math.random`, and `fetch`.) Build the description; run it once, at the top.

``` ts
// ❌ bad — eager, ambient, unrepeatable
const now = Date.now()

// ✅ good — an effect, read from the Clock service
const now = yield* Clock.currentTimeMillis
```

{#errors-are-values .must appliesTo="src examples"}
## Errors are values, not exceptions

Failure is modeled in the typed error channel with `Data.TaggedError`, never `throw`. A caller sees
every way a call can fail from its signature and handles them explicitly. An exception is an escape
from the type system; we don't take it.

``` ts
// ❌ bad — throws; invisible to the caller's type
if (!valid) throw new Error("bad item")

// ✅ good — a typed failure in the E channel
class BadItem extends Data.TaggedError("BadItem")<{ id: string }> {}
return yield* Effect.fail(new BadItem({ id }))
```

{#fail-loudly .must appliesTo="src examples"}
## Fail loudly, never silently

A wrong state errors — or dies — at the earliest point it can be detected, never gets papered over.
A missing RPC handler fails the server at boot, not on first call. Misconfiguration blocks
acquisition with a loud timeout, never a silent placeholder. A value that looks the same but behaves
differently is banned — divergence must surface as a type or dependency error. Silence is the
failure mode we design against.

``` ts
// ❌ bad — a default silently masks missing config
const url = process.env.SERVICE_URL ?? "http://localhost"

// ✅ good — required config fails loudly at load
const url = yield* Config.string("SERVICE_URL")
```

{#illegal-states-unrepresentable .must appliesTo="src examples"}
## Make illegal states unrepresentable

Encode invariants in types so bad combinations can't be constructed. Derive behavior from the
*shape* of a type or config, not from runtime boolean flags bolted on beside it. If a state
shouldn't exist, the type shouldn't permit it — validation you can delete because it can't happen.

``` ts
// ❌ bad — two booleans encode four states, one of them nonsense (loading && error)
interface Conn { loading: boolean; error: boolean; data?: Data }

// ✅ good — a union with no illegal state
type Conn =
  | { _tag: "Loading" }
  | { _tag: "Ready"; data: Data }
  | { _tag: "Failed"; error: Error }
```

{#pipe-dont-wrap .must appliesTo="src examples"}
## Pipe, don't wrap

Data flows top-to-bottom through `.pipe(...)`, not inside-out through nested wrapping. The
combinators are data-last so pipelines stay flat. If you're counting closing parens, it should have
been a pipe.

``` ts
// ❌ bad — inside-out, unreadable
Effect.map(Effect.flatMap(fetchUser(id), loadOrders), summarize)

// ✅ good — linear
fetchUser(id).pipe(Effect.flatMap(loadOrders), Effect.map(summarize))
```

{#generators-when-earned .must appliesTo="src examples"}
## Generators only when they earn it

`.pipe` is the default; `Effect.gen` is a tool for one job — sequential, interdependent steps that
genuinely read clearer as imperative flow. Reaching for `gen` by habit, for a single `map` or a
two-step chain, is wrong. Clarity justifies a generator; nothing else does.

``` ts
// ❌ bad — a generator for a single map
Effect.gen(function* () {
  const u = yield* fetchUser(id)
  return u.name
})

// ✅ good — just pipe it
fetchUser(id).pipe(Effect.map((u) => u.name))
```

{#state-in-references .must appliesTo="src examples"}
## State lives in references, read through effects

Mutable state is a `Ref` / `SubscriptionRef` accessed through an effect — never a plain field a
background fiber mutates. Reads are effects, writes are effects; the value is always observed
consistently.

``` ts
// ❌ bad — a plain field a fiber mutates behind readers' backs
class Counter { count = 0 }

// ✅ good — a Ref; reads and writes are effects
const count = yield* Ref.make(0)
yield* Ref.update(count, (n) => n + 1)
```

{#derive-from-the-contract .must appliesTo="all docs"}
## Derive from the contract

Anything that mirrors the shape of the system is generated from the contract, never hand-maintained
beside it. Dashboard widgets come from `specOf` + `methodMeta`; the rule manifest is derived from
the `{#id .severity}` blocks in these very docs; a node's readiness folds over its one registry of
served HyperServices. A hand-kept parallel list is drift waiting to happen — this is single-source-of-
truth applied to structure.

``` ts
// ❌ bad — a hand-kept list that forgets the next resource
const widgets = [QueueWidget, ProcessWidget]

// ✅ good — derived from the contract, so new HyperServices appear automatically
const widgets = methodsOf(specOf(tag)).map(widgetFor)
```
