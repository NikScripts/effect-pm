# 17 — Legacy removal & migration plan

Remove the pre-toolkit **bespoke control plane**, **`ProcessManager`**,
**`ProcessGroup`**, and **remote `Terminal`** stack, which the **toolkit**
(`Resource` tags + location-transparent layers/RPC) supersedes. Do it in phases:
**build/confirm replacements → deprecate (keep exports) → migrate → delete.**

> Supersedes the relevant rows of [16 — Effect RPC transport migration](./16-effect-rpc-transport-migration.md):
> that plan migrated the *transport* of the control plane to Effect RPC; this plan
> retires the control plane itself in favour of `Resource`.

---

## 0. Load-bearing fact: the dependency direction is favourable

Kept core has **zero hard imports** of the legacy modules — the dependency flows
**legacy → core**, never the reverse (verified: `Process`, `QueueResource`,
`Polling`, `ProcessSchedule`, `RunResource`, the stores, and the log-capture infra
import nothing from `ProcessGroup` / `ProcessManager` / the control plane /
`Terminal`). So legacy is a **removable top layer**; deleting it cannot break the
toolkit, the queue, `Process`, or the stores. The seams are only at the *edges*:
the barrel (`src/index.ts`), the `store/processGroup` facet, the CLI/`bin`, and
`examples/` + `test/`.

---

## 1. Inventory (the "whatever exactly that is")

### KEEP — the toolkit direction (do not touch)
- **Toolkit:** `Resource` (tags + `client`/`server`/`layer`/`Host`), `QueueResource`
  engine + the toolkit `QueueContract`.
- **Process model:** `Process`, `Polling`, `ProcessSchedule`, `RunResource`,
  `HttpClientRunGate`, `ResourceConfigure`.
- **Persistence:** `ProcessStore`, `ProcessStorage`, `RuntimeStorage`, `Query`,
  `storage/{sqlite,redis,prisma}`, `store/{queueResource,runResource,log,processLifecycle,processExecution}`.
- **Log infra:** `LogEntry`, `LogContext`, `Logs` — **NB:** these are *named*
  `ProcessManagerLog*` (`ProcessManagerLogEntry`/`Relay`/`AnnotationKeys`) but are
  **current** (the queue's `logs` capture depends on them). They are also the
  foundation for **Host logs** (§2a): `Logs`' `captureLoggerLayer` +
  `ProcessManagerLogRelay` already capture *every* log in a runtime. Rename to
  neutral `Log*`/`Host*` happens **when Host logs ships**, not as part of the
  legacy cut.
- **UIs:** the terminal TUI (`examples/resource-tui`), the toolkit CLI
  (`makeResourceCli`, `examples/resource-cli`).

### LEGACY — remove
- **Control plane:** `ControlProtocol`, `ControlService`, `ControlRouter`,
  `ControlTransportRpc`, `ControlTransportHttp`, `CommandAuth`, `LogTransportRpc`,
  `Transport` (`httpEndpoint`).
- **Orchestration:** `ProcessManager`, `ProcessGroup` (+ the `store/processGroup`
  facet + `ProcessGroupStore`).
- **Terminal:** `Terminal`, `TerminalRpc` — **dropped outright, no replacement.**
  SSH covers host login; apps bridge to SSH themselves (see
  `docs/recipes/remote-terminal.md`).
- **`CommandAuth`:** **dropped now.** Edge security is covered short-term by the
  one consumer's **Cloudflare Zero Trust**. A first-class auth story for `Resource`
  RPC is a **tracked future feature** (§6), not a migration blocker.
- **Legacy CLI:** `src/cli.ts` (`createCli`/`runCli`/`Cli`) + the control-plane
  `bin/` entrypoints (keep only what the toolkit CLI needs).
- **Examples/tests:** `examples/forms/process-group/**`, control/group scenarios,
  and their tests (`control-*`, `process-manager*`, `process-group*`,
  `log-transport-rpc`, `terminal*`).

### TRANSITIONAL — deprecate + hold during migration
Only `ProcessGroup` / `ProcessManager` need a hold window — they stay
*exported but `@deprecated`* until their orchestration replacement (§2: nestable
`Group.Tag` + instance manager + handoff manager) lands, then are removed in
Phase 4. `Terminal` and `CommandAuth` are **dropped without a hold** (no
replacement needed).

---

## 2. Capability replacement map (nothing should be lost silently)

| Legacy capability | Toolkit replacement | Status |
|---|---|---|
| Remote control of a resource (start/stop/etc.) | `Resource.client` / `Resource.server` + `Resource.Host` | **Exists** |
| Contract / drift verification | `Resource` spec **is** the contract (derived) | **Exists** |
| Log transport / live log stream | `QueueResource`/`Resource` `logs` stream | **Exists** (just built) |
| Many instances behind one transport | `Resource.serveInstances` / `clientInstances` | **Exists** |
| Process-group orchestration (manage N processes/resources as a unit) | **nestable `Group.Tag`** (holds child group tags → infinite nesting) + **instance manager** + **handoff manager** | **Direction set — build (§2b)** |
| Remote terminal session | — (dropped; use SSH) | **Dropped** |
| Control CLI | toolkit CLI (`makeResourceCli`, `manager-cli`) | **Partial — confirm parity** |
| Command auth (`CommandAuth`) | — (Cloudflare Zero Trust short-term; `Resource`-RPC auth later, §6) | **Dropped now** |
| Runtime-wide log capture | **Host logs** (§2a) — generalize `Logs` capture-relay | **Build (foundation exists)** |

Only the **build** rows gate removal of *their* legacy: ship the orchestration
replacement (§2b) before removing `ProcessGroup`/`ProcessManager`; Host logs (§2a)
is additive and independent of removal.

### 2a. Host logs (new feature)

Capture **and stream every log emitted in a runtime** — including resources that
aren't tagged and plain `Effect.log*` calls — as structured `LogEntry`s. This is
the runtime-wide complement to the per-resource `logs` stream already on
`QueueResource`/`Resource`.

The foundation already exists: `Logs.captureLoggerLayer` installs a capture logger
over the whole runtime and `ProcessManagerLogRelay` is a PubSub + tail of every
captured entry. Host logs = **elevate that to a first-class, neutrally-named
feature** (`Host`/`Log*` instead of `ProcessManagerLog*`) and expose its stream
(and a bounded replay tail, like the queue's `logs`). The per-resource capture and
Host logs share one schema (`LogEntry`) and one capture mechanism.

### 2b. Orchestration replacement (`ProcessGroup`/`ProcessManager` → toolkit)

- **nestable `Group.Tag`** — a `Resource`-style tag that holds member tags
  *including child `Group.Tag`s*, giving arbitrary group nesting. (Promote from
  `examples/resource-cli/group.ts` to `src`, add nesting + tests + docs — this is
  the earlier "promote Group.Tag" item, now load-bearing.)
- **instance manager** — manage the lifecycle of resource instances (the
  toolkit-native successor to `ProcessManager`; builds on
  `Resource.serveInstances`/`clientInstances`).
- **handoff manager** — zero-downtime / A-B handoff: consume a `VersionManager`
  (read `descriptor.version` → `migrate` → `enqueueEncoded`) with an optional
  pre-enqueue `transform` (see `docs/plans/03-queue-remote-handoff.md` and the
  observability plan). The queue `release`/`enqueue` round-trip already built is
  its data-plane primitive.

---

## 3. Phases

**Phase 0 — Coordinate (blocking).** `ProcessGroup` is under **active parallel
work** (telemetry-scopes, `189ec3662`, 2026-06-01, on a sibling branch). Removal
must not race it: land/settle that branch first, or freeze it. Do this removal on
its **own branch off `main`** — not the TUI integration branch.

**Phase 1 — Close capability gaps (§2).** Build the toolkit replacements that gate
removal, each shipped + tested before its legacy counterpart is deprecated:
nestable **`Group.Tag`** + **instance manager** + **handoff manager** (§2b), and
confirm **toolkit-CLI parity** with the old CLI. **Host logs** (§2a) is additive —
build it here too, but it doesn't gate any removal. (Terminal and `CommandAuth`
need no build — they're dropped.)

**Phase 2 — Deprecate (non-breaking).** Mark every legacy export `@deprecated`
with a pointer to its replacement; keep the exports. Add a **migration guide**
(old → new, per capability). Point README/docs at the toolkit. Optional: a
one-shot `Effect.logWarning` on legacy entry points.

**Phase 3 — Migrate consumers + examples.** Move internal usages, examples, and
tests onto the toolkit; delete the legacy examples/tests as their toolkit
equivalents land.

**Phase 4 — Remove (breaking, leaf-first).** Delete in dependency order so the
tree never breaks mid-step, verifying `typecheck ×2 + lint + test + build` green
after each:
1. legacy examples + tests
2. `src/cli.ts` + legacy `bin/` + `Transport`
3. `ProcessManager`
4. `ProcessGroup` + `store/processGroup` + `ProcessGroupStore`
5. control plane (`ControlService` → `ControlRouter` → `ControlTransport{Rpc,Http}` → `ControlProtocol` → `CommandAuth` → `LogTransportRpc`)
6. `Terminal` + `TerminalRpc`
7. barrel (`src/index.ts`), `package.json` exports, `tsup` entries for all of the above

**Phase 5 — Post-removal cleanup.** Rename the log infra `ProcessManagerLog*` →
`Log*` (it was never about the manager). Drop any `strict-effect-provide`
exclusions that existed only for now-deleted legacy. Changeset = **major**
(breaking); finalize CHANGELOG + migration guide.

---

## 4. Deprecation mechanics (what we "hold onto temporarily")

- **`@deprecated` jsdoc** on each held export: one line + the replacement pointer.
- **Keep** the `package.json` `exports`, the barrel re-exports, and the `tsup`
  entries for held modules until Phase 4 — so consumers on the old API still build.
- **Migration guide** doc: a table from each removed symbol/subpath to its toolkit
  equivalent, with a short before/after.
- **Semver:** deprecation lands in a minor; removal is a **major**.
- Optional **runtime nudge:** a single `Effect.logWarning("X is deprecated; use Y")`
  on first use of a held entry point.

---

## 5. Risk & coordination

- **Parallel `ProcessGroup` work** is the main risk — Phase 0 gates on it.
- **Public API breakage** — handled by the deprecation window + major bump +
  migration guide.
- **Toolkit safety** — low risk: kept core has no legacy imports (§0), so the
  amputation is contained to edges.
- **Branch hygiene** — own branch off `main`; do **not** entangle with the TUI
  integration branch.

---

## 6. Security (deferred, non-blocking)

`CommandAuth` is dropped with the control plane. Short-term, the sole production
consumer fronts Effect PM with **Cloudflare Zero Trust**, which covers edge
auth/access for now. A first-class **auth story for `Resource` RPC** (signer/verifier
on the toolkit transport, the spiritual successor to `CommandAuth`) is a tracked
**future feature** — needed eventually, but not a prerequisite for the legacy
removal or the toolkit.

## 7. Immediate (the currently-stuck lint gate)

The ESM switch activated `strictEffectProvide` (config 2), which flags 6 internal
layer-provides — 5 in legacy/live core (rate-limiter ×3 in `QueueResource`,
`ControlTransportRpc`, `LogTransportRpc`) + 1 mine (`tapLogs`). Because legacy now
**stays through migration** (not deleted today), the gate must be cleared without
amputation:

- **`tapLogs`** (mine) → scope the capture logger via the `CurrentLoggers`
  FiberRef instead of `Effect.provide(Layer)` — idiomatic, zero risk.
- **rate-limiter** (mine, `QueueResource`) → value-based `RateLimiter.make`
  acquire; provide the store at the queue **Layer**, don't leak the requirement.
- **`ControlTransportRpc` / `LogTransportRpc`** (legacy, RPC server *entry points*
  — the rule's own sanctioned case) → config-exclude from config 2 until Phase 4
  deletes them.

> Status: deferred pending approval of this plan (you said "hold the gate").
