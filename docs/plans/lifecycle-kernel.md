# Plan: Lifecycle kernel

**Status:** Effect-shaped `make` Eng’d (Daemon + core + P13); WorkPool still projects via `of` (L1).  
**Agent:** 5.  
**Decisions / lock register:** [`../handoffs/lifecycle-kernel-decisions.md`](../handoffs/lifecycle-kernel-decisions.md) (approve P-locks item-by-item before Eng).  
**Shipped guide (substrate):** [`../guides/lifecycle.md`](../guides/lifecycle.md).  
**Standards:** [`../standards/`](../standards/) — principles, hyperlink-services, types-and-naming, effect-style, modules-and-boundaries, no-backward-compat, working-agreement, error-handling.

Supersedes the roadmap bullet “Lifecycle kernel (exploratory)” in [`README.md`](./README.md).

---

## 0. Mission

One **`Lifecycle.Service`** is the SSOT for HyperService **runtime lifecycle** — badge + commands —
that **any** HyperService adopts the same way, and that **generic tools** (CLI / TUI / dashboard /
handoff) consume **without kind switches**.

| Is | Is not |
|----|--------|
| Protocol + typed Service handle | A peer HyperService Tag / served resource |
| Spec Role stamps + `make` / `of` / `from` | Policy (dial / verify / conflict / yield) |
| Building blocks every service can use | WorkPool- or Daemon-privileged helpers |
| Layer `Hyperlink.deferStart` for deferred bring-up | Tag-stamped `autoStart` / `Policy.autoStart` |
| One badge enum for tools | A second control plane beside Node / Policy |

**Success looks like:** a dashboard or handoff runner that only knows `Lifecycle.from(tag)` can
start / pause / stop / read State for WorkPool, Daemon, and any app HyperService that opted in —
with capability typing so Pause is absent (not “try and fail”) when the service never offered it.

---

## 1. Why this exists

Today lifecycle truth is **split**:

| Plane | Where truth lives | Problem |
|-------|-------------------|---------|
| WorkPool engine | `phase` + `paused` + latch | Domain snapshot doubles as badge; tools special-case `status.phase` |
| WorkPool tools | `Lifecycle.of` projection | Temporary adapter — two SSOT until L1 |
| Daemon | `Lifecycle.make` | Correct pattern; not yet universal |
| Wire discovery | `methodMeta(…).lifecycle` | Untyped fallback; good, but not enough for typed tools |
| Config | `autoStart` + `DeferStart` | Dual dial for the same fact |

Without a kernel, every new HyperService invents another phase enum; every UI grows another
`kindOf === WorkPool` branch. That violates **single source of truth** and **handles stay thin**
(Observe / UI must not own lifecycle semantics).

---

## 2. Substrate (already Eng’d — locked S1–S9)

Do not re-litigate. Detail + table: [lifecycle-kernel-decisions.md §1](../handoffs/lifecycle-kernel-decisions.md).

| Piece | Location |
|-------|----------|
| Module | `src/Lifecycle.ts` → `hyperlink-ts/Lifecycle` |
| Roles | `"State" \| "Start" \| "Pause" \| "Resume" \| "Stop"` |
| States | `"Idle" \| "Running" \| "Paused" \| "Draining" \| "Off"` |
| Spec stamps | `.pipe(Lifecycle.pause)` (preserve `Marked` / `ref`) |
| Impl | `Lifecycle.make({ initial, onStart, onPause?, onResume?, onStop, afterStop })` |
| Tools | `Lifecycle.of(handle)` / `Lifecycle.from(Tag)` |
| Defer | `Hyperlink.deferStart` on HyperService **layers** only |
| Daemon | Uses Effect-shaped `make` (`restartable: true`) |
| WorkPool | Still projects via `of` — **temporary** until L1 |

---

## 3. Target architecture — Effect / ZIO shaped

Lifecycle is **not** a second Scope and **not** a custom FSM with callback hooks.
It is a **control panel** over Effect structured concurrency:

| Concern | Effect / ZIO primitive | Lifecycle face |
|---------|------------------------|----------------|
| Process / layer lifetime | `Scope` + `acquireRelease` / Layer build scope | Layer close ⇒ `stop` |
| One run loop (Daemon) | `FiberHandle` | `start` = `FiberHandle.run`; `stop` = clear/await |
| N workers (WorkPool) | `FiberSet` (or domain pool under the same Scope) | same verbs |
| Pause / resume | `Latch` | presence of Latch ⇒ Pause/Resume caps |
| Observable badge | `SubscriptionRef` + `changes` | `state` / wire `ref` |
| Teardown | interrupt + await (+ optional drain `release`) | `Draining` → `Off` \| `Idle` |

```text
┌─ Spec ──────────────────────────────────────────────────────────┐
│  Role stamps + State schema  (± Lifecycle.spec sugar)           │
└──────────────────────────────▲──────────────────────────────────┘
                               │ serve
┌─ Layer (Scope) ──────────────┴──────────────────────────────────┐
│  FiberHandle | FiberSet   ← run body                            │
│  Latch?                   ← pause gate (caps from structure)    │
│  SubscriptionRef<State>   ← badge (derived + published)         │
│  acquireRelease / finalizer ← stop on scope close               │
│  Hyperlink.DeferStart     ← skip run until start()              │
└──────────────────────────────▲──────────────────────────────────┘
                               │ yield* / client
┌─ Tools ──────────────────────┴──────────────────────────────────┐
│  Lifecycle.from(Tag) → Service   ui/LifecycleView.pack          │
└─────────────────────────────────────────────────────────────────┘
```

**Fighting Effect (rejected):** inventing FiberStatus; owning fibers outside Scope;
naming this `Resource` (clashes with Effect’s refreshable Resource); `forkDetach` for
HyperServices that the layer owns; encoding pause as interrupt+restart; rebuilding Layers
to start/stop.

### 3.1 Two planes (never conflate)

| Plane | Vocabulary | Owner |
|-------|------------|--------|
| **Node** | `phase: "draining"` (and friends) on node status | Launcher / handoff / Node |
| **HyperService** | `Lifecycle.State` on each participating Tag | Engine via `Lifecycle.make` |

### 3.2 Tag vs layer

| On the Tag / Spec | In the layer / engine |
|-------------------|------------------------|
| Role stamps, `Lifecycle.State` schema | `make` over Handle/Set + Latch; `DeferStart` |
| Caps = which Roles exist (from structure) | Scope finalizer = stop |

### 3.3 Composition grain

| Concern | Shape | Rejected |
|---------|-------|----------|
| Deferred start | Layer pipe `Hyperlink.deferStart` | Tag pipe / Policy / flag-only |
| Role marking | Method pipe `Lifecycle.pause` | Kind helpers |
| Pause | `Latch` in `make` | Callback `onPause` as the model |
| Stop | interrupt / `FiberHandle.clear` + optional drain `release` | Parallel `phase` enum |
| Observe | `ui/LifecycleView` | Methods on Tag |

---

## 4. Target API (dream) — Effect-shaped

### 4.1 Service (tool face — still the wire verbs)

```ts
interface Service<R = never, C extends Caps = FullCaps> {
  readonly state: Subscribable<State>
  readonly start: Effect<void, never, R>
  readonly pause: Effect<void, never, R>   // absent if no Latch
  readonly resume: Effect<void, never, R>
  readonly stop: Effect<void, never, R>
  readonly changes: Stream<State>          // = state.changes (ZIO-ish)
  readonly events: Stream<Lifecycle.Event> // L4 — transition facts
}
```

Caps come **from structure** (Latch present? restartable?) — not a stringly `caps: []` bag
as the primary API (P2 amended toward structural caps).

### 4.2 `make` — compose primitives (not hooks)

```ts
// Daemon — one fiber, restartable, not pausable
const lifecycle = yield* Lifecycle.make({
  run: driverLoop,                    // Effect body
  fiber: "handle",                    // FiberHandle (default)
  restartable: true,                  // afterStop → Idle (else Off)
  // no latch ⇒ no pause/resume on the type
})

// WorkPool — many workers, pausable, drain on stop
const latch = yield* Latch.make(!(cfg.paused ?? false))
const lifecycle = yield* Lifecycle.make({
  run: workersEffect,                 // or run into an existing FiberSet you pass
  fiber: "set",                       // FiberSet
  latch,                              // ⇒ Pause/Resume
  release: windDown,                  // drain / finishActive *before* interrupt await
  restartable: false,                 // → Off
})
```

ZIO mental model: **`ZIO.acquireRelease` + `Fiber` + optional gate**, with a published status.
Effect vocabulary we mirror: `acquireRelease`, `FiberHandle` / `FiberSet`, `Latch`,
`SubscriptionRef`, Scope finalizer.

**Badge derivation (SSOT still published on SubscriptionRef):**

| Condition | State |
|-----------|--------|
| Not yet `run` / cleared + restartable | `Idle` |
| Fiber(s) live, latch open (or no latch) | `Running` |
| Fiber(s) live, latch closed | `Paused` |
| `stop` in progress (release / await) | `Draining` |
| Cleared + not restartable | `Off` |

Engines may still own **domain** machinery (queue sizes, `shutdownMode`) inside `run` /
`release` — not a second badge enum.

**Amends substrate `make({ onStart, onPause, … })`:** that shape is the transitional
substrate; dream `make` takes `run` + optional `latch` + optional `release`.

### 4.3 Spec / impl sugar (P3)

```ts
...Lifecycle.spec({ pausable: true, restartable: false })
...Lifecycle.impl(lifecycle)
```

Wire verb: WorkPool `shutdown` → `stop`.

### 4.4 Tools

```ts
const lc = yield* Lifecycle.from(Jobs)
yield* lc.state.get
yield* lc.start
yield* lc.pause          // typed only if Latch was in make
Observe.use(Jobs, LifecycleView.pack)
```

### 4.5 Deferred start

```ts
WorkPool.serve(Jobs, cfg).pipe(Hyperlink.deferStart)
// ≡ make does not FiberHandle.run until start(); State = Idle
```

---

## 5. State machine

### 5.1 Vocabulary

| State | Meaning | Dialable? (default readiness) |
|-------|---------|-------------------------------|
| `Idle` | Acquired; workers / loop not started (`deferStart`) | Yes — handoff / verify must see pending queues |
| `Running` | Active | Yes |
| `Paused` | Latch closed / loop held; may still accept enqueue | Yes |
| `Draining` | Stop requested; winding down | No |
| `Off` | Terminal for this acquire (WorkPool); Daemon may return to Idle | No |

### 5.2 Transitions as Effect operations (normative)

```text
start  = FiberHandle.run | FiberSet.run*   (no-op if already live)
pause  = Latch.close                       (only if latch)
resume = Latch.open                        (only if latch)
stop   = set Draining → release? → clear/await fibers → Off | Idle
scope close = stop                         (acquireRelease / finalizer)
```

- Idempotent `start` / `stop`.
- No Latch ⇒ Pause/Resume **absent** from the type (structural P2).
- Illegal ops (e.g. pause while `Off`) fail loud — tagged error, not a lying badge.

### 5.3 Events (P4 / L4)

Separate stream from WorkPool **item/queue** `events`:

| Event `_tag` | When |
|--------------|------|
| `Started` | Idle → Running (or first successful start) |
| `Paused` / `Resumed` | Latch transitions |
| `StopRequested` | Entering Draining |
| `Stopped` | Landed Off or Idle per `afterStop` |

PubSub, lossy OK for v1. Durable lifecycle journal is **out of scope** (Stores stay domain).

---

## 6. Adoption recipes

### 6.1 Toolkit engine (WorkPool — L1 credibility test)

1. Replace `phaseRef` + `Lifecycle.of` projection with Effect-shaped `Lifecycle.make`
   (`fiber: "set"` or pass the pool’s FiberSet, `latch`, `release: windDown`).
2. `shutdownMode` lives inside `release` (drain vs finishActive) — then await empty.
3. `status` keeps domain fields; drop `phase` (P1). Prefer State over a parallel `paused` bool.
4. Retire `autoStart`; `DeferStart` ⇒ don’t run until `start()`.
5. Named handle: `lifecycle` + `stop`.

### 6.2 Toolkit engine (Daemon)

Move from hook `make` to `Lifecycle.make({ run: driver, fiber: "handle", restartable: true })`.
No latch ⇒ no pause on the type.

### 6.3 App HyperService (opt-in)

```ts
...Lifecycle.spec({ pausable: false, restartable: true })

const lc = yield* Lifecycle.make({
  run: myLoop,
  fiber: "handle",
  restartable: true,
})
Hyperlink.serve(Tag, { ...Lifecycle.impl(lc), … })
```

Gate / plain Rpc: **opt-in only** (P10).

### 6.4 Generic tool

```ts
const lc = yield* Lifecycle.from(tag)
const s = yield* lc.state.get
if (s === "Idle") yield* lc.start
```

Untyped catalog walk: filter methods by `methodMeta(m).lifecycle`.

---

## 7. Proposed locks (Eng gate)

Approve **item-by-item** in the [decisions doc](../handoffs/lifecycle-kernel-decisions.md) — do not
batch-lock. Summary:

| ID | Lock | Dream Eng blocked without it |
|----|------|------------------------------|
| **P1** | WorkPool on Effect-shaped `make`; retire `phase` + `autoStart` | L1 |
| **P2** | Structural caps (Latch ⇒ Pause; `restartable` ⇒ Idle vs Off) | L3 |
| **P3** | `spec` / `impl`; `shutdown` → `stop` | L2 |
| **P4** | Transition `events` (+ `state.changes` as badge stream) | L4 |
| **P5** | `ui/LifecycleView` pack (Lifecycle ↛ Observe) | L5 |
| **P6** | Readiness from State (Idle dialable) | L1 |
| **P7** | Handoff × Lifecycle; Node plane separate | L6 |
| **P8** | Remote `from` parity | L6 |
| **P9** | `DeferStart` ⇒ don’t run until `start` | L1 |
| **P10** | Gate / Rpc opt-in only | L7 |
| **P11** | Module layout; compose Handle/Set/Latch — not a HyperService kind | all |
| **P12** | Semver / `@locked` | L7 |
| **P13** | **Effect-shaped `make`:** `run` + optional `latch`/`release`/`fiber`; retire hook-centric `onStart`/`onPause` as the public model (substrate may keep hooks until L1/L2) | L1–L2 |

Open questions that block specific P-locks: decisions doc §7.

---

## 8. Eng slices

No calendar estimates — order is technical dependency. **No dream Eng until the slice’s P-locks
are Locked.** Substrate-only fixes OK on the work branch.

| Slice | Depends | Deliverable | Acceptance |
|-------|---------|-------------|------------|
| **L0** | — | Land substrate on `integration` | Guide + Daemon `make` + stamps + `deferStart` on tip; typecheck/tests green |
| **L1** | P1, P6, P9 | WorkPool on `make`; retire `autoStart`; readiness from State; widgets/`lifecycle` | **Eng’d** — no `phase`; `Lifecycle.from(Jobs)`; Idle dialable; changeset |
| **L2** | P3 | `Lifecycle.spec` / `impl`; WorkPool `stop` | **Eng’d** — Spec/impl + `stop`; `.test-d.ts` locks |
| **L3** | P2 | Caps on `Service` / `make` | **Eng’d (A)** — `LifecycleCore` / `LifecyclePausable`; real Latch/fibers; dual ops |
| **L4** | P4 | Events stream | **Eng’d (C)** — derived from `state` changes; Spec `lifecycleEvents`; no Event PubSub |
| **L5** | P5 | `ui/LifecycleView` pack + generic chrome | **Eng’d pack** (`pack` / `pausable`); chrome → Agent G; Lifecycle core tree-shake |

| **L6** | P7, P8 | Handoff docs (no Lifecycle State gate) + client `from` | Same Service API local/remote; handoff fn owns migrate; Track C aligned |
| **L7** | P10+ | Docs polish; `@locked` candidates; archive exploratory wording | Guide = dream truth; decisions P-locks Closed |

Each slice: all tsconfigs typecheck; `@effect/vitest` + `TestClock`; public type/error-channel
changes ship `.test-d.ts`; changeset when public API/behavior changes; **no** `as any` /
`as unknown as`.

---

## 9. Standards checklist (non-negotiable)

| Standard | Application |
|----------|-------------|
| **Composition over inheritance** | Caps and hooks compose; no Lifecycle base class hierarchy |
| **Handles stay thin** | No `Jobs.lifecycleMenu()`; tools use `Lifecycle.from` + Observe packs |
| **Single source of truth** | One badge (`make`); status/domain derive; no `phase` mirror forever |
| **Don't fight the framework** | FiberHandle/Set, Latch, Scope finalizers, SubscriptionRef — not a parallel fiber runtime |
| **Tag = contract, layer = runtime** | Schemas/Roles on Spec; `make` in engine |
| **Piped combinators** | `deferStart`, Role stamps, readiness — not constructor-only flags |
| **No casts** | Caps + Schema; mapping domain→State disappears when `make` is SSOT |
| **Effect style** | Clock/TestClock; bare `yield*`; tagged errors; no raw timers/promises |
| **Module layout** | `Lifecycle.ts` shell + `internal/lifecycle.ts`; flat exports; no `*Contract` |
| **Public vs internal** | Apps import `Lifecycle` / guide; never `internal/` |
| **No kind helpers** | No `fromWorkPool` / `fromDaemon` — ever |
| **Tree-shake** | Lifecycle core must not import Observe / UI / React |
| **Fail loud** | Illegal transitions and missing Stop after caps known → tagged error, not silent success |
| **No backward compat shims** | Rename `shutdown`→`stop` and drop `phase` in minors pre-1.0; update all call sites in the same change |
| **Working agreement** | Decisions doc for locks; no code until go; no batch-lock of P1–P12 |

---

## 10. Migration & blast radius

| Surface | Change | Who feels it |
|---------|--------|--------------|
| `queueStatus.phase` | Remove (or one-cycle deprecated mirror — open Q1) | Dashboard / TUI widgets, tests, examples |
| `autoStart` | Remove | Layer authors → `deferStart` |
| `shutdown` method | → `stop` | Named handles, RPC clients, CLI, docs |
| `Lifecycle.of` mapping `shutdown` | Dies with rename | Internal only if any |
| Readiness detail strings | May say State instead of `phase:` | Verify / fleet UX |
| Observe kind packs | Gain generic Lifecycle chrome; drop hardcoded phase buttons as sole path | Agent G |

**Changeset:** one coherent minor (or sequenced minors per slice) — agents draft; owner approves
`version` / publish.

**Examples / Related:** update in the same slice that breaks them (no orphan shims).

---

## 11. Testing strategy

| Kind | What |
|------|------|
| Runtime (`@effect/vitest`) | `make` transitions; deferStart → Idle → start → Running; pause/resume; stop → Draining → Off/Idle; illegal transition `_tag` |
| WorkPool L1 | Engine uses `make`; no dual badge drift under concurrent pause+enqueue; shutdownMode still honored |
| Remote L6 | `Hyperlink.client` + `Lifecycle.from` same as local |
| Type (`.test-d.ts`) | Caps: Daemon `pause` is error; WorkPool `pause` ok; `spec`/`impl` fragment types |
| Conformance | Optional shared suite for “participating HyperService” once Gate opts in |
| Clock | Any debounce / drain polling via `TestClock` — never real timers |

Assert on `Exit` / `Cause` + `_tag`, never message strings.

---

## 12. Coordination

| Track / agent | Relation |
|---------------|----------|
| **Policy / Track D** | Orthogonal — do not merge into Lifecycle |
| **Launcher / handoff** | L6 + P7; Lifecycle is the per-HyperService badge handoff observes |
| **Named handles (D)** | `lifecycle` on handle; `stop` rename touches named surface |
| **Observe / TUI (G)** | L5 pack ownership — **open Q4**; ask before fighting kind packs |
| **Versioned schema** | Orthogonal — own decisions doc; do not block L1 |
| **`restartSuccessor` / #35–37** | Deferred; may consume Lifecycle State later |

UI agents own React/TUI chrome. Agent 5 owns protocol, Service, toolkit adoption, guide.

---

## 13. Rejected alternatives

| Rejected | Why |
|----------|-----|
| `Policy.autoStart` | Wrong grain (client/advertise vs HyperService start) |
| Tag-piped `deferStart` / `Lifecycle.deferred` | Runtime mode is Layer; Tag is contract |
| `fromWorkPool` / `fromDaemon` | Kind privilege; breaks generic tools |
| Lifecycle as its own served HyperService Tag | Protocol on the service, not a sibling resource |
| Conflating Node `phase` with HyperService State | Two planes |
| Annotation-only without Service | Tools need a typed handle |
| External statechart engine | Compose Effect primitives; publish a badge |
| Hook-only `onStart`/`onPause` as the dream API | Transitional substrate; dream is `run`+Latch+release |
| Inventing FiberStatus / polling fibers for control | Latch + Handle; badge on SubscriptionRef |
| Naming Lifecycle `Resource` | Clashes with Effect refreshable Resource |
| `forkDetach` for layer-owned HyperServices | `forkScoped` / FiberHandle under Layer Scope |
| Merging Lifecycle events into WorkPool item `events` | Different domains |
| Implicit Lifecycle on every Rpc/Gate | Opt-in (P10) |

---

## 14. Immediate next step

1. Owner walks **P1 → P12** in the [decisions doc](../handoffs/lifecycle-kernel-decisions.md) (approve / amend / reject) — item-by-item.  
2. Agent lands **L0** when owner says (substrate → `integration`).  
3. First dream Eng = **L1** after P1 / P6 / P9 Locked — WorkPool SSOT is the credibility test.

Until P-locks land: **no dream Eng**; substrate-only fixes OK on `cursor/lifecycle-defer-start-929b`.
