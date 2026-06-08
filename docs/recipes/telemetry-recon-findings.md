# Telemetry overhaul — pre-implementation recon findings

**Status:** Recon only. **No factory code written.** For owner review before Step 1.
**Branch:** `cursor/telemetry-redesign-bake-faed`
**Gate doc:** [telemetry-requirements.md](./telemetry-requirements.md)
**Recon date:** 2026-06-08

**Purpose:** Per the owner rule ("anything not exactly as defined, or any decision made
without me, must be thoroughly documented"), this records every gap between the locked
requirements spec and the actual codebase, plus recommended resolutions for the OPEN/CLARIFY
CHK items. **Recommendations are not decisions** — each needs owner sign-off, after which the
resolution moves into the requirements doc's CHK table + change log.

---

## 0. Verdict

The requirements spec is **buildable**, but **"port from golden" is a misnomer for the
factory itself**. The golden branch (`origin/cursor/facet-telemetry-158c`) gives us the
**schemas, wire layout, and a *different, older* DSL**. The spec's three-API surface
(`Telemetry.Tag` / `operation` / `start` / `exit` / `Service` / `Wiring` / `metric` /
`state`) **does not exist anywhere** — golden or current branch. It is **net-new code**, not
a port.

**One finding (D3) is a genuine type-system blocker** that must be resolved before Step 1, or
the locked `nodes` API as literally written in the spec cannot deliver the exhaustiveness it
promises. Details below.

---

## 1. Codebase baseline (what exists today)

| Spec assumes | Reality on this branch | Gap |
| --- | --- | --- |
| `src/Telemetry.ts` (Tag factory, Service, registry, Wiring) | **Does not exist** | Net-new file |
| `src/internal/telemetry/` runtime | **Does not exist** | Net-new dir |
| `src/RunResourceIdentity.ts` (`TypeTag`/`TypeId`) | **Does not exist** | Net-new (Step 0) |
| `store/RunResourceTag.ts` | **Does not exist** | Net-new |
| Debt to delete: `defineEvent` | Present in `src/TelemetryHub.ts` + `src/store/RunResourceTelemetry.ts` | As documented |
| Debt to delete: kernel `stateRef` | Present in `src/RunResource.ts` | As documented |
| Export subpaths for Telemetry/Identity | **Absent** from `package.json` — only `./store/RunResource`, `./ProcessStore`, etc. exist | Step 0 must add `./Telemetry`, `./store/RunResourceTelemetry`, `./store/RunResourceTag`, `./RunResourceIdentity` |

`TelemetryHub` itself is healthy and stays as-is (router only): `emit`, `sink`, `sinkLayer`,
`layer`, `telemetryWireId`. The new factory bridges into it.

`State.Scope` (`src/State.ts`) is present and matches the spec's Pattern-A usage:
`.layer(leaf)`, `.provide(leaf)`, `.run(leaf, eff)`, `.withLeaf(key, fields)(id)`, `.Leaf`,
`.State`, `.Schema.Leaf`, `.Schema.State`. `RunResourceScope` / `RunScope`
(`src/RunResourceScope.ts`) already exist with the exact shape the spec's schemas select from
(`RunScope.Schema.State.Run.runId` resolves correctly).

---

## 2. "Port from golden" — what actually transfers

Golden's DSL (`src/internal/store/telemetry.ts`, used in `src/store/runResource.ts`):

```ts
const RunResourceTelemetry = ProcessStore.telemetry(RunResourceScope)(
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(                       // lowercase `tag`, variadic ...path
    Telemetry.event("Started", RunResourceRunStarted).pipe(/* store/log legs */),
    Telemetry.event("Completed", RunResourceRunCompleted).pipe(...),
    Telemetry.event("Failed", RunResourceRunFailed).pipe(...),
  ),
  Telemetry.tag("State")(
    Telemetry.event("Changed", RunResourceStateChanged).pipe(...),
  ),
);
```

| Reusable from golden (port) | Net-new for spec (build) |
| --- | --- |
| `Telemetry.Schema<Self>()(Scope)({...})` base | `Telemetry.Tag<Self>(id)(...)` **class** factory |
| `Telemetry.terminal.clockMillis` / `.durationMs` | `Telemetry.operation<Input>(name)(Scope, ...legs)` |
| `Telemetry.namespace` | `Telemetry.start` / `Telemetry.exit({onSuccess,onFailure,onInterrupt})` |
| `Telemetry.event` (name + schema) | Node handles (G) on Tag class statics |
| `telemetryWireId` machinery | `Telemetry.Service(Tag, wiring)` + `.layer` |
| Wire layout `RunResource.Run.Started` etc. | `Telemetry.Wiring<Tag>` = `{ extend, nodes }`, `PlainFields<Schema>` |
| RunResource schema **fields** | `Telemetry.metric.*`, `Telemetry.state`, field sources (`Operation.input`, `Exit.*`, `Clock.now`) |
| `Telemetry.logWarning` (golden: pipe leg) | Calling API: op builder `.provide()`, `OperationContext` |

**Net:** roughly the schema definitions + `Telemetry.Schema`/`terminal`/wire-id plumbing
port over. The operation/wiring/service/calling machinery — the bulk of Steps 1, 3, 4, 5, 6 —
is written from scratch.

---

## 3. Divergences: spec vs. reality (not yet in the CHK table)

| ID | Divergence | Severity | Notes |
| --- | --- | --- | --- |
| **D1** | Spec renames golden `Telemetry.tag` → `Telemetry.group`; groups do **not** nest (golden `tag` took variadic `...path`, allowing nesting) | Low — spec acknowledges this in §4 DSL rules | Deliberate, locked. No action. |
| **D2** | `extend` is keyed by a **computed property `[RunResourceScope]`** (spec §4 / Step 3). `RunResourceScope` is a `Context.Service` class — using it as an object key coerces to a string and is **not guaranteed unique or stable** across scopes | **Medium** | Impl must key `extend` by a stable id (e.g. scope `.id` string, which exists) rather than the class object, OR the factory accepts the scope ref and derives the key internally. Affects API 3 ergonomics. |
| **D3** | `nodes` is keyed by **computed property node handles** (`[RunResourceTag.Run.run.Started]: { bind: {...} }`) **and** the spec requires **per-node exhaustive `bind` typed from `PlainFields<Schema>`** of *that specific node*. **TypeScript computed-key object literals collapse to a single index signature and cannot carry a distinct value type per computed key.** You cannot have both "keys are runtime handles" and "each key's value is type-checked against that key's own schema." | **HIGH — blocker** | The locked `LayerNodeConfig<Schema>` exhaustiveness (spec §4, "compile error if a node with PlainFields≠never is missing") is **unachievable as written** with handle-keyed literals. See §4 resolution options. Must decide before Step 1. |
| **D4** | Golden puts `logWarning` as a **`.pipe` leg on the event**; spec puts it as a **`logWarning:` property on the wiring node**. | Low — spec §12 explicitly rejects the pipe form, locked | No action; just noting the golden code does it the old way. |
| **D5** | Spec's `RunResourceStateSchema` (state snapshot embedded in `State.Changed`) lives today in the **to-be-deleted** `store/RunResourceTelemetry.ts`. The new Tag schema references it. | Low | Need to decide its new home (likely `RunResourceScope` `extend` shape or a shared schema module) so deleting the debt file doesn't orphan it. |
| **D6** | No telemetry/identity **export subpaths** exist in `package.json`. Step 0 lists them as deliverables but the spec's compose examples already import from `@nikscripts/effect-pm/store/RunResourceTelemetry`. | Low | Step 0 mechanical; flagged so it isn't skipped. |

---

## 4. D3 in detail (the blocker) + resolution options

The spec wants, simultaneously:
1. `nodes` **keyed by node handles**, "not wire strings" (§4, § Node handles).
2. **Exhaustive** `bind` per node, **type-checked against each node's own `PlainFields`**,
   compile-error on omission (§4 `LayerNodeConfig`, "Exhaustiveness").

These conflict. In `{ [SomeHandle]: value }`, TS types the literal with one index signature;
it does not know "this key is `Run.run.Started` therefore value must satisfy
`LayerNodeConfig<RunStartedSchema>`." Exhaustiveness over a closed set of handles is also lost.

**Resolution options (need owner pick):**

- **(A) Type-level keys = wire-id string literals; runtime = handles.** `nodes` is typed as
  `{ [K in NodeWireId<Tag>]: LayerNodeConfig<SchemaAt<Tag, K>> }`. Authors write string-literal
  keys (`"RunResource.Run.Started"`); the factory maps them to handles internally. **Pro:**
  full exhaustiveness + per-node typing, standard mapped-type pattern (this is how Effect RPC /
  `HashMap`-style builders do it). **Con:** contradicts the spec's "keyed by handles, not wire
  strings" lock — but note the wire-id omits the operation name, so `Run.run.Started` and a
  hypothetical second op's `Started` could collide; keys may need the node *path*
  (`Run.run.Started`) not the wire id.
- **(B) Builder function instead of object literal.** `Telemetry.wiring(tag).node(tag.Run.run.Started, { bind })...` — fluent, handle-typed per call, exhaustiveness enforced by a phantom accumulator + a final `.build()` that errors if incomplete. **Pro:** keeps handles as first-class values, full typing. **Con:** more factory machinery; not the `satisfies Telemetry.Wiring<Tag>` object form the spec shows.
- **(C) Keep handle keys, drop compile-time exhaustiveness.** Validate completeness at
  **layer-build runtime** instead. **Pro:** matches spec literally. **Con:** violates the
  spec's locked "compile error" guarantee; defers failures to runtime. Not recommended.

**Recommendation: (A)**, with keys = **node path** (`"Run.run.Started"`, `"State.Changed"`)
rather than wire id, to avoid op-name collisions. This preserves the spec's two hard
requirements (exhaustiveness + per-node bind typing) at the cost of the "keyed by handle
object" ergonomic. Flag for owner since it edits a locked detail.

---

## 5. OPEN / CLARIFY CHK items — recommended resolutions

Each needs owner OK; then it moves to the requirements CHK table as LOCKED + a change-log row.

| CHK | Question | Recommendation | Confidence |
| --- | --- | --- | --- |
| **CHK-03** | `Telemetry.Service` return shape (class vs namespace vs branded const) | **Branded const object.** Tag is a `class` (spec uses `class extends Telemetry.Tag<Self>(id)(...)`, matches repo's class-extends convention). Service is `const X = Telemetry.Service(Tag, wiring)` — a frozen branded object carrying Calling paths (`.Run.run`, `.State.Changed`), `.layer`, and catalog metadata, consumed by `Telemetry.registry([...])` via `typeof`. | High |
| **CHK-04** | Must zero-plain-field events appear in `nodes`? | **No.** `LayerNodeConfig` already encodes `PlainFields extends never ? { logWarning? } : { bind; logWarning? }`. Zero-plain-field nodes are **optional** in `nodes` (only `logWarning?`). Only `PlainFields ≠ never` nodes are required. | High |
| **CHK-12** | Optional plain fields (e.g. `Retried.error`) — required bind or omittable? | **Optional schema field → optional `bind` key** (`bind: { error?: FieldSource }`). Required fields stay required. | Medium — confirm against final Queue schemas |
| **CHK-13** | `RateLimit.Exceeded` wiring (many plain fields) | Defer to Slice E (Queue branch) as the spec says; full bind table authored there. No blocker for RunResource slices A–D. | n/a |
| **CHK-14** | Identity subpath exact string | `TypeTag = "@nikscripts/effect-pm/RunResource"` (const), file `src/RunResourceIdentity.ts`, **package subpath** `@nikscripts/effect-pm/RunResourceIdentity`. Matches existing scope-id namespacing (`@nikscripts/effect-pm/run/RunResourceScope`). Confirm on first `package.json` export edit (Step 0). | Medium |

---

## 6. Recommended entry point (once D3 + CHKs are signed off)

Step 0 + Step 1 are then unblocked and sequential:

1. **Step 0** — add export subpaths (D6), create `src/RunResourceIdentity.ts` (CHK-14),
   align plan 21 vocabulary. Mechanical.
2. **Step 1** — build `src/Telemetry.ts` Tag factory (`namespace`/`group`/`operation`/`start`/
   `exit`/`event`/`Schema`), porting golden's `Telemetry.Schema`/`terminal`/wire-id plumbing;
   generate node handles. **Gate:** `RunResourceTag` compiles, no extend/bind/logWarning on Tag.
3. **Step 2** — port RunResource schemas + tree to `RunResourceTag`. **D5**: decide new home
   for `RunResourceStateSchema` before deleting the debt file.

Everything downstream (Wiring/Service/runtime, Steps 3–6) inherits the D3 decision, so it
**must land first**.

---

## 7. Blocking decisions for owner (before any code)

1. **D3** — pick resolution A / B / C for `nodes` keying vs. exhaustiveness. *(Recommend A.)*
2. **CHK-03** — confirm Service = branded const, Tag = class. *(Recommend yes.)*
3. **CHK-04 / CHK-12 / CHK-14** — confirm recommendations above.
4. **D2** — confirm `extend` keys by scope `.id` (not the class object).
5. **D5** — confirm new home for `RunResourceStateSchema`.

Non-blocking (proceed on default): D1, D4, D6.
