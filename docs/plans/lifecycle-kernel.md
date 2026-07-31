# Plan: Lifecycle kernel

**Status:** designed — substrate Eng’d on `cursor/lifecycle-defer-start-929b`; dream not Eng’d.  
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
| Daemon | Uses `make` (`afterStop: "Idle"`) |
| WorkPool | Still projects via `of` — **temporary** until L1 |

---

## 3. Target architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ Spec (contract)                                                 │
│   lifecycle: ref(State).pipe(Lifecycle.state)                    │
│   start / pause? / resume? / stop .pipe(Lifecycle.<role>)       │
│   — optional sugar: ...Lifecycle.spec({ caps })                 │
└────────────────────────────▲────────────────────────────────────┘
                             │ Hyperlink.serve / toolkit serve
┌────────────────────────────┴────────────────────────────────────┐
│ Layer / engine                                                  │
│   const lc = yield* Lifecycle.make({ …hooks… })  ← badge SSOT   │
│   Hyperlink.DeferStart → initial Idle when omitted              │
│   domain refs (sizes, latch) stay domain — not a second badge   │
└────────────────────────────▲────────────────────────────────────┘
                             │ yield* Tag / client
┌────────────────────────────┴────────────────────────────────────┐
│ Tools                                                           │
│   Lifecycle.from(Tag) → Service  (local = remote)               │
│   ui/LifecycleView.pack → Observe (core Lifecycle ↛ Observe)    │
│   handoff: gate on State; Node.phase stays node-plane           │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Two planes (never conflate)

| Plane | Vocabulary | Owner |
|-------|------------|--------|
| **Node** | `phase: "draining"` (and friends) on node status | Launcher / handoff / Node |
| **HyperService** | `Lifecycle.State` on each participating Tag | That service’s engine via `make` |

Handoff may *observe* HyperService State; it must not reuse Node enums as Lifecycle, or vice versa.

### 3.2 Tag vs layer (hyperlink-services)

| On the Tag / Spec | In the layer / engine |
|-------------------|------------------------|
| Role stamps, `Lifecycle.State` schema, method names | `Lifecycle.make`, hooks, `DeferStart` read |
| Capability set (which Roles exist) | Transition enforcement, PubSub events |

Never put worker / latch / auto-start mode on the Tag. Never put wire schemas only in layer bags.

### 3.3 Composition grain

| Concern | Shape | Rejected |
|---------|-------|----------|
| Deferred start | Layer pipe `Hyperlink.deferStart` | Tag pipe, Policy fragment, constructor flag alone |
| Role marking | Method pipe `Lifecycle.pause` | Kind-specific annotate helpers |
| Readiness | Existing `withReadiness` / defaults derived from State | Second readiness system |
| Observe chrome | Pack under `ui/LifecycleView` | Methods on Tag / `Jobs.observe()` |

---

## 4. Target API (dream)

### 4.1 Capability-parameterized Service

```ts
type Role = "State" | "Start" | "Pause" | "Resume" | "Stop"
// Caps row TBD under P2 — union of Roles or branded With<"Start" | "Stop">

interface Service<R = never, C extends Caps = FullCaps> {
  readonly state: Subscribable<State>
  readonly start: Effect<void, never, R>    // present when "Start" ∈ C
  readonly pause: Effect<void, never, R>   // absent when Pause not in C
  readonly resume: Effect<void, never, R>
  readonly stop: Effect<void, never, R>
  readonly events: Stream<Lifecycle.Event> // L4
}
```

**Principle:** Prefer **absent members** (or impossible branded types) over
`Effect.fail(Unsupported)` as the happy path for typed tools. Keep `Unsupported` only for
dynamic Spec walks where caps are unknown.

### 4.2 `make` — sole badge SSOT

```ts
const lifecycle = yield* Lifecycle.make({
  initial: "Idle", // or omit → DeferStart ? Idle : Running
  caps: ["Start", "Pause", "Resume", "Stop"], // Daemon: Start + Stop
  onStart,
  onPause?,
  onResume?,
  onStop,
  afterStop: "Off" | "Idle",
})
```

Engines **do not** keep a parallel `phase` enum after L1. Latch / `shutdownMode` / sizes remain
**domain** machinery; they drive hooks that update Lifecycle State, they are not the badge.

### 4.3 Spec / impl sugar (P3)

```ts
// Contract
...Lifecycle.spec({ caps: ["Start", "Pause", "Resume", "Stop"] })

// Impl
...Lifecycle.impl(lifecycle)
```

**Wire verb:** Prefer rename WorkPool `shutdown` → `stop` (one Role, one method name). Reject
forever-mapping `shutdown`↔`stop` inside `of()`.

### 4.4 Tools

```ts
const lc = yield* Lifecycle.from(Jobs)
yield* lc.state.get
yield* lc.start
Observe.use(Jobs, LifecycleView.pack) // ui/ — not in Lifecycle core
```

### 4.5 Deferred start

```ts
WorkPool.serve(Jobs, cfg).pipe(Hyperlink.deferStart)
// make({ initial }) / DeferStart ambient; call-site autoStart retires (P1/P9)
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

### 5.2 Legal transitions (normative for `make`)

```text
Idle ──start──► Running
Running ──pause──► Paused
Paused ──resume──► Running
Running|Paused|Idle ──stop──► Draining ──(hooks complete)──► Off | Idle(afterStop)
Off ── (no start; re-acquire / new layer) ──
```

- Idempotent `start` while `Running`: no-op success.
- `pause` / `resume` when caps omit them: **not on the type** (P2); dynamic path → `Unsupported`.
- `stop` while `Draining` / `Off`: idempotent.
- Illegal jumps (e.g. `Off` → `Paused`) fail loud with a tagged error — never silent no-op that
  lies about State.

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

1. Replace `phaseRef` + dual projection with `Lifecycle.make` inside `internal/workPool`.
2. Hooks: `onStart` fork workers; `onPause`/`onResume` latch; `onStop` existing shutdown /
   `shutdownMode` path; `afterStop: "Off"`.
3. `status` keeps **domain** fields (`sizes`, `inFlight`, `completed`); drop `phase` once tools
   use `lifecycle` (P1). Fold “paused” into State === `"Paused"` or keep boolean only if queue UX
   still needs a domain shortcut — prefer derive.
4. Retire `autoStart`; honor only `DeferStart` + `make` initial.
5. Named handle exposes `lifecycle` + `stop` (after P3 rename).

### 6.2 Toolkit engine (Daemon — already close)

Already on `make`. L2/L3: `Lifecycle.spec` / caps without Pause; typed Service has no `pause`.

### 6.3 App HyperService (opt-in)

```ts
const MySpec = {
  ...Lifecycle.spec({ caps: ["Start", "Stop"] }),
  // domain methods…
}

// layer
const lc = yield* Lifecycle.make({ caps: ["Start", "Stop"], … })
Hyperlink.serve(Tag, { ...Lifecycle.impl(lc), … })
```

Gate / plain Rpc: **opt-in only** (P10). No implicit Lifecycle on every HyperService.

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
| **P1** | WorkPool engine SSOT on `make`; retire dual `phase` + `autoStart` | L1 |
| **P2** | Capability typing (absent Pause on Daemon) | L3 |
| **P3** | `spec` / `impl` sugar; `shutdown` → `stop` | L2 |
| **P4** | `Lifecycle.Event` + `Service.events` | L4 |
| **P5** | Observe pack in `ui/LifecycleView` (Lifecycle ↛ Observe) | L5 |
| **P6** | Readiness: Idle/Running/Paused ready; Draining/Off not | L1 |
| **P7** | Handoff × Lifecycle gates; Node plane separate | L6 |
| **P8** | Remote `from(clientTag)` parity | L6 |
| **P9** | `deferStart` + `make` read `DeferStart` when `initial` omitted | L1 |
| **P10** | Gate / plain Rpc opt-in only | L7 docs |
| **P11** | `Lifecycle.ts` + `internal/lifecycle.ts`; not a HyperService kind | all |
| **P12** | Semver / `@locked` when dream settles; minors pre-1.0 | L7 |

Open questions that block specific P-locks: decisions doc §7.

---

## 8. Eng slices

No calendar estimates — order is technical dependency. **No dream Eng until the slice’s P-locks
are Locked.** Substrate-only fixes OK on the work branch.

| Slice | Depends | Deliverable | Acceptance |
|-------|---------|-------------|------------|
| **L0** | — | Land substrate on `integration` | Guide + Daemon `make` + stamps + `deferStart` on tip; typecheck/tests green |
| **L1** | P1, P6, P9 | WorkPool on `make`; retire `autoStart`; readiness from State; widgets/`lifecycle` | No `phase` dual as badge SSOT; `Lifecycle.from(Jobs)` drives start/stop; Idle dialable; changeset |
| **L2** | P3 | `Lifecycle.spec` / `impl`; WorkPool `stop` | Spec fragment compiles; named handle + control Spec use `stop`; `.test-d.ts` |
| **L3** | P2 | Caps on `Service` / `make` | Daemon Service type has no `pause`; WorkPool has pause; Unsupported only dynamic |
| **L4** | P4 | Events stream | Tests assert `_tag`; domain queue events unchanged |
| **L5** | P5 | `ui/LifecycleView` pack + generic chrome | Coordinate Agent G; Lifecycle core tree-shake (no Observe/React) |
| **L6** | P7, P8 | Handoff gates + client `from` conformance | Same Service API local/remote; handoff brief Track C aligned |
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
| **Don't fight the framework** | Layer pipes, Spec stamps, Effect services — not plugin arrays |
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
| External statechart engine | Projection-friendly events + small `make` machine suffice |
| Merging Lifecycle events into WorkPool item `events` | Different domains; keep streams separate |
| Implicit Lifecycle on every Rpc/Gate | Opt-in (P10); Gate has no background engine in v1 |

---

## 14. Immediate next step

1. Owner walks **P1 → P12** in the [decisions doc](../handoffs/lifecycle-kernel-decisions.md) (approve / amend / reject) — item-by-item.  
2. Agent lands **L0** when owner says (substrate → `integration`).  
3. First dream Eng = **L1** after P1 / P6 / P9 Locked — WorkPool SSOT is the credibility test.

Until P-locks land: **no dream Eng**; substrate-only fixes OK on `cursor/lifecycle-defer-start-929b`.
