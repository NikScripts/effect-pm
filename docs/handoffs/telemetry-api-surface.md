# Telemetry / State — API surface inventory

**Status:** Active bake (Jun 2026). Companion to [telemetry-redesign-decisions.md](./telemetry-redesign-decisions.md) (semantics = source of truth). **This doc names every part of the API surface.** Plan: (1) name everything [this doc], (2) walk it **one item at a time** documenting *every form* — signature variants, where accepted, how to use, (3) **Bundle** shape last.

**Naming:** `Telemetry.Tag` has two shapes — **Compose** (over a standalone `State.Tag`; telemetry-optional) and **Bundle** (single `Telemetry.Tag`, no standalone `State.Tag`). No "Form 1 / Form 2".

**Ids:** `State.Tag` and `Telemetry.Tag` each carry their own required, distinct id — `<Resource>/<Name>` (`…/QueueState`, `…/QueueTelemetry`). Scopes too (`…/QueueScope`, `…/EntryScope`).

**Legend:** 🔶 forms TBD (walk) · ✅ locked · 🕓 deferred · ⛔ dropped / not-a-thing. Item IDs are stable — reference them when locking forms.

---

## 1. Module functions — `State`
- **S1** · `State.Scope(domain)(id, fields)` — declare a **top-level scope** (first **branch** off `State.Root`); `fields` required (no empty scopes) · ✅
- **S2** · `State.Tag<Self>(domain)(stateId, …parts)` — **structure-only** tag (ops/scopes/handles/spans; no schemas) · 🔶
- **S3** · `State.operation(name, scope?, Input?)(…triad)` — **operation** anchor (start / `inner` / exit) · 🔶
- **S4** · `State.inner(…)` — the `ctx.telemetry` surface (middle events, nested ops, group-import) · 🔶
- **S5** · `State.leaf(name, fields)` — inline single-use leaf (as an op's scope arg) · 🔶
- **S6** · `State.Root` — the **real root** of the scope tree (run-level state; `runId` → `e.runId`); every `State.Scope` is a branch off it · 🔶
- **S7** · `State.Changed` — internal transition event; `State.Changed.operation` format (§6.6) · 🔶

## 2. Module functions — `Telemetry`
- **T1** · `Telemetry.Tag<Self>(StateTag, GlobalBase?)(telId, tree)` — **Compose** (richer tag over a `State.Tag`) · 🔶
- **T2** · `Telemetry.Tag<Self>(domain, GlobalBase?)(telId, structure)` — **Bundle** (single self-contained tag) · 🔶 (last)
- **T3** · `Telemetry.Service(Tag, wiring)` — runtime = tag + wiring + layer · 🔶
- **T4** · `Telemetry.Schema<Self>(ScopeTel?)((e) => …)` — reusable schema base (scope-bound, or scope-free global) · 🔶
- **T5** · `Telemetry.namespace(name)(…parts)` — ref-shortener (enclosing namespace) · 🔶
- **T6** · `Telemetry.group(name, Default?)(…parts)` — group label + optional default base · 🔶
- **T7** · `Telemetry.event(name, schema?)` — name an **inner** (middle) event · 🔶
- **T8** · `Telemetry.declare(name, schema?)` — named cross-site event (name-only / schema-carrying) · 🔶
- **T9** · `Telemetry.start(name, schema?)` — **start** leg · 🔶
- **T10** · `Telemetry.exit(…outcomes)` — **exit** leg (success / interrupted / failure fold) · 🔶
- **T11** · `Telemetry.success(name, schema?)` — exit outcome · 🔶
- **T12** · `Telemetry.interrupted(name, schema?)` — exit outcome · 🔶
- **T13** · `Telemetry.failure(name, schema?)` — exit outcome · 🔶
- **T14** · `Telemetry.spread(group)` — flat group-import into `inner` (drops prefix) · 🔶
- **T15** · `Telemetry.update(…)` — wiring-side telemetry-state write · 🔶 (shape OPEN)

## 3. Metric markers — `Telemetry.metric.*`
- **M1** · `Telemetry.metric.gauge` — gauge field marker (telemetry-state) · 🔶
- **M2** · `Telemetry.metric.counter` — counter marker · 🔶 (confirm exists)
- **M3** · `Telemetry.metric.histogram` — histogram marker · 🔶 (confirm exists)
- **M4** · `Telemetry.metric.summary` — summary marker · 🔶 (confirm exists)

## 4. Service classes — methods on produced classes

### 4a. Scope class — `State.Scope(...)` / `.withLeaf(...)` result
- **C1** · `.withLeaf(name, fields)(id)` — child scope (new identity + id) · 🔶
- **C2** · `.telemetry(fields)` — telemetry half (same identity, **no new id**) · 🔶
- **C3** · `.layer(values)` — provide the scope at a runtime boundary · 🔶

### 4b. Telemetry scope class — `.telemetry(...)` result (`…Tel`)
- **C4** · `.event((e) => …)` — inline scope-bound schema value (no base) · 🔶
- **C5** · `.withLeaf(name, fields)(id)` — child scope from the Tel half · 🔶

### 4c. Schema base class — `Telemetry.Schema(...)` result
- **C6** · `.extend((e) => …)` — base + extras (field-adding; **never a bare arrow**) · 🔶
- **C7** · `.Schema(ScopeTel)((e) => …)` — extend into another reusable base · 🔶

### 4d. `State.Tag` instance
- **C8** · operation handles (`.enqueue`, `.processEntry`, …) — invoke ops (wrap work) · 🔶
- **C9** · `.provide(scopeValues)` — bind scope to a call · 🔶

### 4e. `Telemetry.Tag` instance
- **C10** · event handles (`.Lifecycle.Started`, …) — emit standalone events (grouped) · 🔶
- **C11** · operation handles — invoke ops (typed payloads) · 🔶
- **C12** · `.provide(scopeValues)` — bind scope to a call · 🔶
- **C13** · `ctx.telemetry.*` — nested ops + middle + imported events (inside an op) · 🔶

### 4f. `Telemetry.Service`
- **C14** · `.layer` — the runtime layer (wiring bound) · 🔶

## 5. Schema context `e` (inside `Telemetry.Schema` / `.extend` / `.event`)
- **E1** · `e.root` — navigable scope tree (root fields + telemetry + nested branches; intersection-gated) · 🔶
- **E2** · `e.leaf` — current deepest leaf · 🔶
- **E3** · `e.input` — operation input (from `State.operation` `Input`) · 🔶
- **E4** · `e.exit` — exit-only: `e.exit.duration`, `e.exit.cause`, … · 🔶
- **E5** · `e.clock` — timestamp source · 🔶
- **E6** · `e.runId` — ambient run identity (needs no scope) · 🔶

## 6. Call / runtime surface (process side)
- **R1** · `op(input).provide({ …scope })` — invoke an operation with input + scope · 🔶
- **R2** · `Scope.layer({ …fields })` — open a scope at the runtime boundary · 🔶
- **R3** · `ctx.scope` — process view of the open scope (telemetry half hidden) · 🔶
- **R4** · `ctx.input` — the operation's input inside the body · 🔶
- **R5** · `ctx.telemetry` — emit middle/nested/imported events inside an op · 🔶
- **R6** · `Effect.provide(Service.layer)` — install the telemetry runtime · 🔶

## 7. Reserved / special
- **X1** · wire = `Namespace.Group.Event` — every event's three-string identity
- **X2** · `Internal` namespace — reserved (e.g. `Internal.State.Changed`)

## 8. Deferred / dropped
- **D1** · `Telemetry.import(…)` — 🕓 deferred (cross-facet catalogs)
- **D2** · `Telemetry.wires({…})` — 🕓 deferred (predefined shared catalogs)
- **D3** · multiple namespaces per Tag — 🕓 deferred
- **D4** · `Telemetry.Event(Tag, "id")` — ⛔ dropped (use the tree)
- **D5** · `Telemetry.default(…)` as a leg part — ⛔ not-a-thing (default = `group(name, Default)` / `default:` key)

---

## 9. Walk order (one at a time)
S1 → C1, C2, C3 · S2 → C8, C9 · S3 · S4 (+ T14) · S5 · T5, T6 · T9–T13, T10 · T7, T8 · T4 (+ C4, C6, C7) · M1–M4 · E1–E6 · T1 (Compose) + C10–C13 · R1–R6 · S6, S7, T15 (wiring) · **T2 (Bundle) last** · T3 (Service) + C14.

---

## 10. Locked forms
*(filled as we walk — each item's every shape as a type + usage example.)*

### S1 · `State.Scope` ✅
The first branch off `State.Root` (not the root — S6 is). Single call shape; `fields` required (no empty scopes).
```ts
declare const Scope: <Domain extends State.Domain>(domain: Domain) =>
  <const Id extends string, Fields extends Schema.Struct.Fields>(
    id: Id,           // required, "<Resource>/<Name>"
    fields: Fields,   // required, plain Schema only (metric markers belong to .telemetry / C2)
  ) => State.ScopeClass<Domain, Id, Fields>
```
```ts
// declare a top-level scope
class QueueScope extends State.Scope(QueueResource)("@scope/queue/QueueScope", { queueId: Schema.String }) {}
// produced class exposes: .withBranch (C1), .telemetry (C2), .layer (C3)
```
🔶 Open: rename `leaf`→`branch` for node-creating APIs (pending); `e.root` = `State.Root` vs outermost `State.Scope`.
