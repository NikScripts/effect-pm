# 12 - Standalone process instances (`Process.spawn`) and queue opens (`QueueResource.open`)

## Status

Future plan — design consensus from internal discussion (not implemented).

## Intent

Provide **explicitly multi-instance** ways to supervise `Process.make` definitions
and to acquire `QueueResource` runtimes **outside** typed `ProcessGroup`
registration:

- **`Process.spawn`**: forks the **same supervised driver** logic as today's
  `process.effect` (schedule reconciliation + polling/store paths + existing
  `ProcessMirror`-backed semantics), but returns an **opaque instance handle**
  that carries the supervisor **fiber**, **human-oriented instance identity** for
  logs/debugging, and **operator controls**.
- **`QueueResource.open`**: parallel lifecycle split so **definition/configuration**
  and **fiber-acquiring acquisition** compose like **`Process.spawn`** (queue
  workers + latch parity with today's **`QueueResource.make`** scoped Effect).

Goals:

- Scripts and embedding code can supervise **many concurrent instances** of the
  same blueprint without teaching `ProcessGroup` about ad-hoc spawns.
- **Suspend / wake** (**operator enable**) is separate from **`arm` / `disarm`**
  (**schedule-driven eligibility** surfaced through the mirror). Schedule may
  change `armed` unpredictably over time and must **not** type-level track that,
  while **suspend** can be phantom-typed relative to scripted operator calls.
- **ProcessGroup orchestration**, **typed contracts**, **`ControlService` HTTP
  targets**, and **ProcessManager** remote flows remain unchanged: **standalone
  instance handles stay out of `make(entries)` tuples** by design — they are only
  controlled **in the Effect scope where spawned**.

---

## Architectural boundary: ProcessGroup-owned vs spawned instances

Keep the **existing methodology**:

- **`ProcessGroup`** owns **lifecycle registration maps**, **fleet-level
  primitives** (status, typed controls, CLI/HTTP surfaces), **coordinated
  stop/restart**.
- **`Process.spawn`** forks a **fresh supervisor fiber per call** into the
  **caller's **`Scope`/runtime** — it does **not** register with a group map.
  Returned handle exposes **narrow controls** (**suspend**, **wake**, graceful
  **shutdown**, **interrupt**) but **cannot** substitute for `ProcessDefinition`
  / `entries` tuples used by **`ProcessGroup.make`**.
- Spawned handles are **isolated**, not second-class semantics: callers still
  provide **the same **`Layer`**s** (**`QueueResource`**, **`ProcessStore`**, user
  services) when running the containing program; spawned logic **reuses** the
  **same **`Process`** definition** (**`Process.make`**) and internal mirror
  implementation as grouped processes.

Forbidden / non-goals for v1:

- Passing a **`ProcessSpawnHandle`** (name TBD) into **`makeProcessGroup`** /
  **`ProcessGroup.Service`** **`entries`**.
- Automatically linking spawned instances into group **contract** payloads or CLI
  without an explicit redesign (that would collide with isolation).

---

## Supervisor parity

**`Process.spawn`** must reuse the **`createProcess` / **`process.effect`**
machinery**, not fork a thinner "runner" that skips schedule reconciliation /
polling internals. Divergence guarantees:

- Bugs fixed in **`Process`** apply to grouped and spawned runs equally.
- **Tests** should target shared helpers internally (even if **public DX**
  differs).

Implication:

- Spawn path **builds identical mirror + reconcile loop semantics** modulo new
  **suspend / wake** gating (see **Operator controls** and **suspend** gating
  in **risks**, below).

---

## Identity: definition id versus instance id

**Definition id**: existing stable string passed to **`Process.make`** (and
canonical **`Process.Service`** tags), e.g. **`"@app/repo/HeavyJob"`**.

**Instance id**:

- Prefer **explicit** names for logs and dashboards
  (**`staging-worker`**, **`tenant-42-sync`**).
- Omitting a name ⇒ generate a **short random id** (target **4–6** characters).
  Prefer implementing generation via **`Random` / cryptographic random**
  surfaced as **`Effect`**, never non-deterministic **`Math.random`** at the pure
  type boundary, so **Vitest **`TestRandom`**** hooks work.

**Suggested log / debug display string**:

- **`{definitionId}#{instanceSegment}`**, e.g. **`@app/repo/HeavyJob#k7wz`**.
  The **`#`** visually separates NPM-style definition scope from ephemeral
  instance token; **`@scope/pkg/Id#`** is preferable to stuffing another **`/`**
  segment that reads like nested package IDs.
- **Anonymous** (**generated id**): still render **`definitionId#{generated}`** —
  avoid awkward **`#.`** placeholders — use the generated token as the RHS.

Open question:

- Collision policy for generated ids (**log ambiguity only vs scope-local
  monotonic suffix** vs longer tokens).

---

## Public API sketches (conceptual — types TBD during implementation)

### Curried instance name

```ts
// Named instance — operator identity fixed for observability.
const instance = yield* Process.spawn("instanceName")(process);

// Anonymous instance — deterministic-by-test RNG effect generates short suffix.
const instance = yield* Process.spawn(process as Process<R>);
```

Exact overload resolution must avoid clashes between **`string`** IDs and passing
mistaken strings where a **`Process`** is expected (**discriminated overloads**
or **`as const`**, or split entry points **`Process.spawn.named`** vs
`**`Process.spawn.anonymous`**, if inference fights).

Returned **handle**:

- Holds **opaque reference** to **supervisor `Fiber`** (or equivalent typed
  join/interrupt primitive).
- Exposes combinators (**methods** vs **pipeable free functions**) that update
  **suspend** refs and optionally forward to **`ProcessSchedule`** where
  **arm/disarm at the mirror** aligns with **`ProcessScheduleControls`** (**see**
  **`arm` ambiguity** below).
- Optionally exposes **narrow read model** (**`getStatus`**, join completion)
  distilled from **`Process`** without leaking full grouped control surface.

### Operator controls (**suspend**, **wake**)

**suspend** (**enabled = false** at mirror level):

- **Hard requirement**: block **tracked user work dispatch** (**`trackedProgram`**
  invocation path) regardless of **`armed`**.
- Expected to gate **polling tick → user effect**, **immediate runs**
  (**`runImmediately`**), and **`reconcile`**-scheduled **spawn of new entry**
  fibers where appropriate.

**wake** (**enabled = true**): inverse of suspend.

Unresolved policy (**must decide before ships**):

- Whether **suspend** interrupts in-flight **`userEffect`** immediately vs waits
  until the next polling / reconcile boundary vs **dual modes** (e.g.
  **`suspend({ interrupt: … })`**).

### Schedule controls (**arm**, **disarm**)

Today's **`mirror.armed`** is computed from **`ProcessSchedule`** entries
(**`summarizeScheduleState`** / **`refreshScheduleMirror`**). Standalone knobs
might map to **`ProcessSchedule`** mutations (**add/clear/set entries**) —
mirroring **`ProcessGroup.process(p).`** — or expose **narrow helpers** backed
by the schedule service **inside** spawned scope.

Naming collision risk:

- If instance API exports **`disarm`** for operator suspend, **`disarm`** as
  "**schedule armed false**" is confusing beside **`suspend`**. Prefer:

  - **`suspend` / **`wake`** for operator enable gates, **and**

  - **`ProcessSchedule`**-explicit names for schedule authoring (**scheduleDisarm /
    scheduleArm**) **or**

  - surface schedule only through **`Effect.flatMap`(scheduleControls,...)** /
    **`yield*` schedule service** patterns.

Open question (**grill blocker**):

- Whether standalone instance controls include **schedule mutation at all**, or
  only **`suspend`** + **`interrupt`**, leaving schedule editing entirely to
  **`yield*` `ProcessSchedule`** from inside **`userEffect`**.

---

## Phantom typing (**`ProcessInstance<Enabled, …>`**)

Desired property:

**`enabled` / **`suspend`** state is phantom-typed** when operators only use typed
combinators (**`wake`** only after **`suspend`**, **`suspend`** only when active).

Explicit limitations:

**`armed`** is **never** phantom-typed — schedule churn is asynchronous vs script
ordering.

Typing strategy:

Brand **`ProcessSpawnHandle<Enabled extends boolean, R, …>`**, methods return
return **narrowed** handle refs or **immutable** copy-of-handle wrappers if
needed for soundness (**mutable internal refs + phantom param** mismatch is a TS
classic footgun — validate with **private fields** + **`as const`** brands).

Graduation criterion:

Phantom API does not **claim** **`armed`**; docs state **explicitly**.

---

## QueueResource parallel: **`make`** vs **`open`**

Today's **`QueueResource.make`** yields **`QueueHandle`** under **`Scope`**.

Split:

1. **`QueueResource.define` / reused config object** (**name TBD**) — describe
    queue (**effect**, concurrency, codecs, **`itemSchema`**), **does not fork
    workers**.
2. **`QueueResource.open("instance")(definition)`** or **`QueueResource.open(definition)`**

    mirrors **`spawn`** ergonomics (**optional instance string**, short random).

Same isolation rules apply: **standalone opened queue handles** are **not**
`ProcessGroup` **entries**.

---

## Dependencies and interaction with other plans

- **[07 - Typed ProcessGroup and remote ProcessManager](./07-process-manager.md)**:
    contract + HTTP targeting remain **definition-oriented** — document that
    **spawned instances are unreachable** remotely unless a separate feature
    attaches them (out of scope).
- **[06 - Process lifecycle hooks](./06-process-lifecycle-hooks.md)** and
    **[08 - Lifecycle machine](./08-lifecycle-machine.md)**: spawned instances
    may become an early adoptee for **`enabled`** transitions vs schedule
    transitions — converge vocabulary (**suspend**/armed/running/stopped).

---

## Risks / invariants checklist

Implementers must reconcile **three ingress paths**:

1. **Schedule reconciliation** spawning entry instances (**`spawnEntryInstance`**
    path).
2. **Polling ticks** looping **`trackedProgram`**
3. **`runImmediately`**

Suspend gating belongs in **central eligibility checks** (no scattered one-off
skips) to avoid regressions (see reconcile loop and **`spawnEntryInstance`** path
around `Process.ts`: **~560–744**).

---

## Questions to grill / lock (**TODO before implementation spec**)

Answer these in subsequent design passes or spike PRs:

1. **suspend interrupt policy** — preempt in-flight **`userEffect`** yes/no/modes?

2. **schedule controls on spawned handle** — expose narrow mirror writers vs
    force **`ProcessSchedule`** **`yield*`** only?

3. **arity** — **currying only** (**`spawn(id)(proc)`**) vs overloaded **single
    call (`spawn(proc, opts?)`)** for better TS inference?

4. **dispose story** — does **`shutdown`** **`Scope.Release`** unify with
    **`Fiber` join interruption** guarantees?

5. **`QueueResource.open`** and **`Scope`**: match **`QueueResource.make`**
    lifecycle (**defer worker fibers until **`open`**)? Define **dual-open /
    idempotence** semantics.

---

## Graduation criteria

- Public **`Process.spawn`** (**instance id + phantom optional suspend branding**)
    shipped with mirrored tests proving **parity** grouped vs spawned for a
    reference blueprint (**schedule + polling** optional matrix).
- Public **`QueueResource.open`** symmetry documented with **migration note**
    from **`make`**-only ergonomics (**deprecation window if needed** — breaking
    allowed per project policy).
- `docs/` user-facing narratives updated (**`PACKAGE-GUIDE`**, **`PROCESS-API`**,
  **`examples`**) declaring the **explicit isolation boundary** versus
  **`ProcessGroup`**.

- **`CURRENT-ROADMAP`** Phase referencing **standalone ownership** (**Phase F**) can
    mark plan **partially superseded / satisfied** once spawn ownership model is in
    place.
