# Brief — Launcher + node handoff (Agent 5)

**Status:** Track A + **Track B Eng'd** on tip. **Track C Locked #27–34 + #39 Eng'd** (`Directory.changes`, `Node.drain` / `shutdown` / `launch`, directory `peersLayer` + `lookupClient` rebind, serve-site `{ handoff }` fn, WorkPool baked `releaseEnqueueHandoff`). Live A→B suite: `test/handoff-ab-cutover.test.ts`. **#39 retires #33 `withHandoff` / #34's tag mechanism.** **#35–37** deferred (owner-confirmed). Explicit A/B launcher mode deferred.  
**Opened:** 2026-07-25 (owner via Agent G).  
**Audience:** next agent picking up launcher + handoff / migration discussion.

---

## Locked (2026-07-27, owner)

1. **Spine α — dumb spawn-and-exit launcher.** Bring-up only; exits when the spawn job is done. Not a long-lived fleet supervisor. Nodes own processes after start; Lookup is the control brain. (Rejects spine β: launcher-as-`Layer.launch(Fleet…)` lifecycle owner.)
2. **No Eng until API is locked with the owner.** Design → owner go on concrete API surface → then build. No APIs from `launcher-decisions.md` memory.
3. **Bake order:** Track **A** (spawn+exit launcher API) first; then B (Lookup-directed startup), C (handoff), D (clients). Do not tangle tracks.
4. **Track A exit gate = Ready** (not merely spawned, not Lookup-registered). Launcher waits until the child is ready, then exits. Registration / Lookup remains the child’s (node’s) job after that.
5. **Launcher → node ownership transfer is explicit** — not only “process is up, launcher walks away.”
6. **Track A handoff shape = both (parent steps + child ack):**
   - **Parent API** exposes composeable phases (not a buried `launch`): roughly `spawn → awaitReady → handoff → exit`.
   - **Child** must **ack** ownership (“I am ready; I own myself”) so the transfer is a real handshake on the wire, not an assumption from readiness alone.
   - Prefer reusing existing node / verify substrate for the ack; **no new control plane**. Verb locked in #11 (`Node.assume`).
7. **Ready is first-class and high-bar** (owner: “first class and top notch”) — not “port open / process alive.”
   - **Child** declares readiness through the existing **`withReadiness` / `Readiness` / node status** surface (served HyperServices participate; defaults ready when unset).
   - **Launcher `awaitReady`** is a **named phase** that waits until that readiness is true **and** proven cross-process (reuse `verifyConnection` / deep classify — loud failures, typed errors). No ad-hoc health hacks.
   - **Ready ≠ ownership.** Ready means “fit to serve”; **handoff ack** (locked #6) is the separate “I own myself; launcher may exit” step.
   - Quality bar: Effect-shaped API, Schema/tagged errors, no silent timeouts-as-success; composeable with Track A phases.
8. **`awaitReady` aggregation = allReady by default, configurable escape hatch.**
   - **Default:** every served Hyperlink on the node must be ready (`allReady`-shaped).
   - **Escape hatch:** caller may narrow (critical subset / Lookup-first / staged bring-up) without a second readiness system — same `withReadiness` substrate, scoped set.
9. **Ownership ack = first-class node RPC verb** (not a status-poll side effect, not a bring-up-only side channel).
   - Launcher calls it **after** Ready; child acks “I own myself; launcher may exit.”
   - Effect/Schema, loud typed failures.
   - Node status may **mirror** ownership for dashboards; the handshake is the verb.
   - Verb: **`Node.assume`** (see #11).
10. **Module split (parent vs node):**
    - **`hyperlink-ts/Launcher`** — short-lived bring-up toolkit: `spawn` / `awaitReady` / `handoff` (+ convenience `up`).
    - **`Node`** — owns readiness surface + ownership **ack RPC** (steady-state control plane after launcher exits).
    - **CLI** (`hl` / `hyperlink` later) — thin over Launcher; not a second control plane.
    - Do **not** put OS spawn into `Node` (already transport/catalog-heavy).
11. **API names (locked):**
    - Parent: `Launcher.spawn` → `Launcher.awaitReady` → `Launcher.handoff`; convenience `Launcher.up` = compose of those then exit.
    - Node ownership RPC: **`Node.assume`** (child assumes ownership; launcher may exit).
    - Rejected names: `launch` (reads as long-lived / spine β), `release` (collides with WorkPool.release), `fork` (OS/Effect ambiguity).
12. **`Group` is not a process / launch cohort.**
    - Group = **hierarchy of handles** for organization in general (same handle may appear in **many** groups).
    - You *can* group layers via Group, but that is not exclusive or load-bearing for launch.
    - Launcher must **not** treat `Group` as “the set of OS processes to spawn” or as SSOT for placement/process topology (Lookup/Node remain that).
    - CLI path sugar from group paths (if any) is addressing ergonomics only — not ownership of lifecycle.
13. **Product = library launcher (spine α), not blank-worker/Lookup-day-one, not “no launcher package.”**
    - Ship `hyperlink-ts/Launcher` + `Node.assume` / Ready handshake; optional thin `hl up` later.
    - **v1 grain:** 1 node ↔ 1 OS process; parent **probes** Ready (`verifyConnection` / status); child is an **autonomous entry** (app owns serve/listen in its `main`).
    - Track **B** (Lookup-directed / blank worker) later — keep assume/ready on Node so it can plug in.
    - Rejected for Track A: host-only bring-up with Hyperlink as handshake docs alone; collapsed process|fiber (`hl dev`) deferred.
14. **Spawn input (unit) locked:**
    ```ts
    {
      node: AnyNode  // dial / verify / handoff target
      process: ChildProcess  // Effect ChildProcess.make(…)
      // optional sugar: entry (+ cwd/env/exec) that builds ChildProcess
      ready?: {
        services?: ReadonlyArray<string>  // HyperService wire keys; omit ⇒ allReady-shaped
        timeout?: Duration.Input
      }
    }
    ```
    - Multi-node: `ReadonlyArray` of that unit (thin alias OK later). **Not** `Group`.
    - Grounded in nameless-listen demo + `verifyConnection` / `Node.status` keys.
15. **Parent API = custody handle + `Launcher.up`.**
    - `Launcher.spawn(spec)` → **`Launcher.Handle`** (custody; launcher still holds the child) with `.awaitReady()` / `.handoff()`.
    - `.handoff()` performs `Node.assume` on the wire; custody ends; do not use the handle for control afterward; launcher may exit.
    - `Launcher.up(spec | ReadonlyArray<spec>)` = spawn → awaitReady → handoff (per unit) then exit — one-shot (`Handle` only internal to `up`).
    - **Only** `spawn` / `up` construct a `Handle` — no public constructors.
    - Primary surface is the handle, not flat `Launcher.awaitReady(child)` free functions.
16. **Custody type name = `Launcher.Handle`** (docs may say “custody”; reject `Custody` / `Child` as the type name).
17. **Effect for everything (hard — owner).** Launcher / assume / Ready path follows package Effect platform policy end-to-end:
    - **Process:** Effect `ChildProcess` / `ChildProcessSpawner` (+ `@effect/platform-node` layers) — **no** raw `node:child_process` / `spawn`.
    - **Time / wait:** Effect `Schedule` / `Duration` / `TestClock` in tests — **no** ad-hoc `sleep` as the Ready gate (demos may; library must poll with Effect).
    - **Config / token inject sugar:** Effect `Config` (or typed spawn options), **not** bare `process.env` as API or protocol.
    - **Errors:** `Data.TaggedError` / `Schema.TaggedError` — **never** extend native `Error`; no message-string matching.
    - **Wire:** Schema-first RPC for `Node.assume`; verify/Ready reuse existing Effect `verifyConnection` / status.
    - **Composition:** `Effect` / `Layer` / `Scope` — no Promise/`async` in Launcher internals.
    - Browser doesn’t OS-spawn; `Launcher` is a Node-platform module. **`Node.assume` / Ready stay wire-portable** (http/ws/ipc).
18. **`Node.assume` wire = token payload (open injection).**
    - RPC: `assume({ token: string })` — Schema’d; loud tagged failures (`AssumeTokenMismatch` / reuse / not-ready).
    - Launcher **mints** token at `spawn`, holds on `Launcher.Handle`; `.handoff()` calls `assume({ token })`.
    - **Injection is not the protocol** — app chooses how the child learns the token (`ChildProcess` env/argv/etc. via Effect process options, or later bootstrap). Optional **Effect `Config`** helper for local Node; not required.
    - Child **rejects** `assume` until Ready. Status may mirror `ownership: "launcher" | "self"`.
    - Rejected as default: nullary `assume()`; env-as-wire-contract; bidirectional launcher server for v1.
19. **Ready / handoff failure channels (tagged only).**
    - Reuse verify stack where it fits: `NodeUnreachable` (and kin), `ServiceNotReady` as **transient** while polling.
    - **New:** `Launcher.ReadyTimedOut` `{ node, services?, timeout }` — bound wait expired.
    - **New:** `Launcher.ChildExited` `{ node, code? }` — child dies during `awaitReady`.
    - **New (assume):** `AssumeTokenMismatch` / `AssumeTokenReused` / `AssumeNotReady` — Schema/TaggedError.
    - Poll with Effect `Schedule` + `Duration` from `ready.timeout` (default **`"30 seconds"`** unless Eng finds a better house default).
    - No native `Error`, no message-string matching; tests use `TestClock`.
20. **Assume token = opaque high-entropy string (Effect mint + Redacted).**
    - Mint with Effect `Random` (sufficient bytes → hex or base64url) — **no** raw `crypto.randomUUID` / Node crypto in app code.
    - Wire: `Schema.String` (optional brand `Launcher.Token` if it stays thin).
    - Hold and log as **`Redacted`** — never cleartext in logs.
    - Reject UUID-as-the-story if it implies non-Effect globals; brand OK as sugar over the same mint.
21. **Package export = own subpath `hyperlink-ts/Launcher`.**
    - Public module: `src/Launcher.ts` (flat Effect-true namespace) + `src/internal/launcher.ts` engine as needed.
    - Barrel / `package.json` `exports` entry for `hyperlink-ts/Launcher` — **not** nested under `Node`.
    - **Node-platform only** (mirror other OS-spawn entrypoints); `Node.assume` / Ready stay on `hyperlink-ts/Node` and remain wire-portable.
    - Eng may choose exact packaging nuance (e.g. peer `@effect/platform-node`) without reopening the subpath decision.
22. **Track B = membership plane (Lookup), not a second launcher.** Three planes:
    - **Custody** — Launcher (Track A): spawn → Ready → `Node.assume` → exit.
    - **Membership** — Lookup (Track B): Identity / Directory / Advice after assume.
    - **Migration** — Track C later; **Clients** — Track D later.
23. **Directive = membership arbitration, not code-loading.** Child entry chooses capabilities (autonomous HyperServices). Lookup decides who wins / where clients dial. **No** blank worker, **no** `Lookup.assign`, **no** assign-before-serve in B.
24. **Topology day one = local-first IPC Lookup** (`Lookup.layer` / `layerOptions` / `client`). Soft-bake OK for demos; prod pipes explicit Lookup. Cross-network Lookup deferred.
25. **Launcher rendezvous unchanged** — stable addressed `SpawnSpec.node`; Lookup is child-after-assume (#4). No nameless discovery via Launcher in B.
26. **Takeover in B = directory row only** — `askIncumbent` + node-status `yield`. Public `ListenOptions.onYield` configures refuse/accept. Drain / state / old shutdown = Track C.
27. **Directory membership push (Eng'd, owner go 2026-07-29)** — Lookup fans out live directory mutations so nodes notice A→B dial swaps without restart.
    - Wire: `Directory.changes` stream of `DirectoryUpserted` (`dialChanged: true` when dial target moves) + `DirectoryRemoved`.
    - Sugar: `Lookup.changes`, `Lookup.directoryTable()` (scoped live map; seed with `nodesServing` when a cold snapshot is needed).
    - **Follow-up Eng'd:** directory `peersLayer` + `lookupClient` hot-rebind on `Directory.changes` dial moves.
28. **Trigger = version-upgrade product story; initiation = incoming node after A+B, not Directory yield alone** (owner lock 2026-07-29).
    - Headline: Launcher A → Ready → `assume`, win membership (B), then migration (C).
    - **Who initiates:** the **incoming node** (or thin CLI over Node) after `Node.assume` — never Launcher, never Lookup `assign`.
    - B `askIncumbent` / `yield` may swap the Directory **row** first; C does not start from yield alone.
29. **Grain = per HyperService, opt-in (default off)** (owner lock 2026-07-29).
    - Whole-node cutover = compose opted-in per-service handoffs, then old-node shutdown (#32).
    - A HyperService without handoff config is **not** migrated by C.
30. **Cutover v1 = drain-then-cut on the old node; no dual-serve; no client redirect in C** (owner lock 2026-07-29).
    - Old node enters **draining** (#31): refuse new membership yield; finish in-flight work; cut when drain complete.
    - Dual-serve / client redirect → Track D (or later re-lock).
31. **Discovery during swap = draining ≠ dead; Directory row held; yield fail-closed while draining** (owner lock 2026-07-29; Eng'd).
    - `Node.Status.phase`: `"running" | "draining"` (WorkPool-shaped).
    - `Node.drain(node)` / status `drain` RPC — idempotent enter draining; ping/status stay up.
    - While draining: node-status `yield` **always refuses** (overrides `ListenOptions.onYield`).
    - Lookup `livenessReplace` / `askIncumbent` cannot steal a reachable draining incumbent.
32. **Old-node shutdown = Node control-plane sequence after migrate; compose B unregister + Advice clear** (owner lock 2026-07-29; **Eng'd**).
    - **Not** `Launcher.kill`. **Not** Lookup-owned process kill. **Module home = `Node`**.
    - **`Node.shutdown(node)`** — drain → opted-in handoffs (#33) → Advice clear → Directory unregister → listen exit.
    - **`Node.launch(node, layer)`** — prefer over bare `Layer.launch`; races the shutdown latch (no `process.exit`).
    - Per-service handoff (#33/#34) runs between drain and leave.
33. **Layer shape = opt-in handoff config on the HyperService (serve / tag layer), not ListenOptions** (owner lock 2026-07-29; **superseded by #39** 2026-07-29).
    - Keep `ListenOptions` for A/B (`assumeToken`, `onConflict`, `onYield`).
    - ~~`Hyperlink.withHandoff("drainOnly" | "workPoolRelease")` — pipe on the tag~~ **Retired** — replaced by the serve-site `{ handoff }` fn (#39). The "opt-in per-HyperService, default off, not `ListenOptions`" spirit stands; the *mechanism* is a fn, not a tag-stamped strategy string.
    - Runs during `Node.shutdown` after drain, before Lookup leave.
34. **Stateful v1 = non-transferable by default; WorkPool opt-in `release` → peer `enqueue`; Stores stay per-node** (owner lock 2026-07-29; **mechanism superseded by #39**).
    - **Default:** queues / stores / Gate / Daemon journals are **not** auto-moved across nodes.
    - **WorkPool transfer:** `WorkPool.serve` / `serveRemote` **always bake** `WorkPool.releaseEnqueueHandoff` (release → peer `enqueue`). No config knob yet (opt-out later). Directory peer excludes **self by dial** (not `nodeKey`).
    - **Rejected for v1:** shared cross-node Store; library-magic state shipping; Gate/Daemon live migrate.
39. **Handoff = serve-site function returning outcomes, not a tag strategy string** (owner lock 2026-07-29; **Eng'd**). Retires #33's `withHandoff` + library strategy runners.
    - **Not on the Tag, not an RPC Spec member.** `Hyperlink.serve(Tag, impl, third?)` where `third` is an `AnyNode` (sugar for `{ node }`) **or** an options bag `{ node?, handoff? }`. No bare handoff-fn overload.
    - **Signature:** `handoff: (from, to, ctx) => Effect<void | HandoffOutcome>` — `from` = local handle, `to` = peer client (same service type, dialed from the Directory excluding self **by dial**).
    - **Outcomes:** tagged `_tag` PascalCase — `Done` | `Retry` | `Defer`. Type / API camelCase (`HandoffOutcome`, `HandoffContext`, `handoffContext`). `ctx.done` / `ctx.retry` / `ctx.defer` are Effects that succeed with those tags. Returning `void` coerces to `Done` at the runner (happy path easy).
    - **Orchestration:** run local on the OUTGOING node during `Node.shutdown` after drain; dial the Directory peer (exclude self by dial); run `handoff(from, to, ctx)`.
    - **Retry** = bounded re-run of that service's handoff. **Defer** / **NoPeer** / **RetryExhausted** / **Failed** (defect/`orDie`) = do **not** leave / shut down — restore `phase: "running"`, clear the shutting-down latch, surface typed `HandoffDeferred` (`_tag: "HandoffDeferred"`, `.reason` PascalCase via `handoffDeferralReason`) to the shutdown caller (over the wire on the node-status `shutdown` RPC error channel). Match by `_tag`, never message strings.
    - **No peer when handoff set ⇒ `HandoffDeferred({ reason: "NoPeer" })`** (keep up, log warning).
    - **WorkPool:** handoff **baked into** `WorkPool.serve` / `serveRemote` (`releaseEnqueueHandoff`). Config override/opt-out deferred. **Daemon / Gate:** optional `handoff` in config bag → `Hyperlink.serve` options (no baked migrate).
    - **Deferred:** `restartSuccessor`; full `Node.http` 3rd-arg unify (serve `{ node }` currently threads registration only, not a tag re-stamp for `client(Tag)`).
38. **Replacement addressing recipe (owner lock 2026-07-29)** — not an A/B product mode.
    - You **give addresses** (or mint at listen); you do not “configure as A/B.”
    - Typical cutover: **same `nodeKey`, new dial** → Directory `dialChanged` → clients rebind (`lookupClient` / directory `peersLayer`).
    - Lookup = membership / client dial ownership only — **not** migration owner. Incoming initiates after assume (#28).
    - Config planes stay split: `ListenOptions` (`assumeToken`, `onConflict`, `onYield`) + per-service serve `{ handoff }` fn (#39).
    - Address-less tags: handle has no dial; listen mints → `ListenNode` + Directory; clients use `lookupClient`.
    - Launcher custody still wants **addressed** `SpawnSpec.node`. **Explicit less-automated A/B launcher deferred** (owner go 2026-07-29).

Historical “Locked” rows in [`launcher-decisions.md`](./launcher-decisions.md) remain **reference only** unless re-locked here.

### Track A — research note (2026-07-27): what already exists

**Build on (shipped):**
- OS child pattern: Effect `ChildProcess` / `ChildProcessSpawner` (see `examples/node-nameless-listen-demo.ts`) — no package Launcher yet; demos `spawn` + sleep.
- Child entry: `Layer.launch(Node.unix|http|ws(…, [Hyperlink.serve…]))` forms.
- Ready substrate: `withReadiness` / `Readiness` / `allReady` / `Node.status` (per-HyperService readiness rollup) / `Hyperlink.verifyConnection` (deep → `ServiceNotReady`).
- Identity/placement: `Lookup.Identity` / `Directory` / `Advice`, `Hyperlink.identity` — child’s job after Ready.
- Ops CLI: `Hyperlink.cli` + TUI — **control surface on running services**, not bring-up.
- `Group.Tag` / `members` / `isGroup` — handle hierarchy only (`src/Group.ts`).

**Gone / do not resurrect:** `ProcessManager`, `ProcessGroup`, legacy `effect-pm-group-child`, `Fleet.launch` (spine β).

**Gaps vs Track A (closed):** `hyperlink-ts/Launcher` + `Node.assume` + Ready poll + spawn→ready→assume→unref kit are on tip. Remaining product gaps are Tracks B/C/D.

### Track A — Eng'd (2026-07-27; refinements 2026-07-28)

Shipped on tip (owner Eng go + refinements):

- `hyperlink-ts/Launcher` — `spawn` / `Handle.awaitReady` / `Handle.handoff` / `Handle.kill` / `up` / `mintToken` / `command` / `entry` / `layer`
- Branded `Token` + `Redacted`; Ready Config (`readyTimeoutConfig` / `readyPollConfig`) resolved at `spawn`
- Tag-typed `ready.services`; fail-closed kill on `ReadyTimedOut`; `up` concurrency option
- Guide: [`docs/guides/launcher.md`](../guides/launcher.md)
- `Node.assume({ token })` + `AssumeTokenMismatch` / `AssumeTokenReused` / `AssumeNotReady`
- `ListenOptions.assumeToken` / `Node.assumeTokenConfig` (`HYPERLINK_ASSUME_TOKEN`)
- Status mirror `ownership?: "launcher" | "self"` when assume is armed
- Tests: `test/node-assume.test.ts`, `test/launcher.test.ts` (+ `.test-d.ts`, harness)

Eng defaults: 32-byte hex token; Ready poll `100 millis` with per-dial `2 seconds` bound; outer default `"30 seconds"`.

**Next bake:** Track D remainder (client redirect / dual-serve — `lookupClient` rebind Eng'd); explicit A/B launcher later; #35–37 stay deferred.

### Track B — research note (2026-07-27): what already exists

**Owner framing (locked spine, not Track B API):** dumb launcher exits; **nodes own processes**; **Lookup directs startup** (placement / role / takeover — verbs TBD); prefer reuse over new nouns.

**Build on (shipped Lookup):**
- **`Identity.claim` / `resolve`** — exclusive “who implements K?” (winner serves; loser → client via `Hyperlink.identity`, or `AddressLessClaimLost` on address-less listen).
- **`Directory.advertise` / `unregister` / `nodesServing` / `changes`** — presence catalog derived from listen serve list (not a second app-maintained catalog); membership push for dial-swap notify (Locked #27).
- **`Advice.advise` / `preferred` / `clear`** — `serviceKey → preferred nodeKey` for **clients** when Identity missed and multiple directory rows exist (`Hyperlink.lookupClient`). Does **not** answer “what roles are assigned to *this* node.”
- **`OnConflict` / `askIncumbent` + node-status `yield`** — cooperative **directory-row** replacement on duplicate `nodeKey`. Default `yield` = accept; **not** drain / shutdown / state transfer (Track C territory).
- **Soft-bake `Lookup.layer`** — nameless `unix`/`http` compete for `/tmp/hyperlink-ts-lookup.sock` (same-machine); no Launcher required. Cross-network Lookup server/client **not** implemented (`layerNode` / `client` are IPC-path today).

**Track A vs Lookup (gap):** Launcher never calls Lookup. `SpawnSpec.node` must be addressed; Ready / assume only. Registration is the child’s job after assume (#4). No blank-worker / startup-directive / role-assignment API exists. Server serve lists are **non-empty**; Launcher allReady treats zero served HyperServices as not ready.

**Gone / do not resurrect:** launcher-owned parallel directory; ProcessManager / Fleet.launch as control brain.

**Historical opinion only** (`launcher-decisions.md`): spawn → ready → `Advice.advise` → drain old → unregister → clearAdvice. Useful shape to discuss; **not locked**.

### Track B — Eng'd (2026-07-27)

Owner locked #22–26; Eng on tip:

- Public **`ListenOptions.onYield`** → node-status `yield` (refuse/accept for `askIncumbent`).
- Recipe + example: custody (`Launcher.up`) then membership (`Lookup.client` + advertise/identity).
- Guide: [`identity-coordinator.md`](../guides/identity-coordinator.md) planes section.

**Still deferred:** blank worker / assign protocol; HTTP/WS Lookup; nameless Launcher discovery; Track D client redirect / dual-serve; explicit A/B launcher. `lookupClient` + directory `peersLayer` hot-rebind Eng'd. Track C Locked #27–34 + **#39** Eng'd (serve-site `{ handoff }` + WorkPool `releaseEnqueueHandoff` + live A→B suite); #35–37 deferred below.

### Track C — research note (2026-07-28): what already exists

**Mission:** a served HyperService moves from one node to another without callers noticing — including **zero-downtime version updates** and **cross-version skew as the normal case**. Framing: [`node-handoff-mission.md`](./node-handoff-mission.md).

| Plane | Owner | In / out |
|-------|--------|----------|
| **Custody** (A) | `Launcher` | spawn → Ready → `Node.assume` → exit. **Not** migration. |
| **Membership** (B) | Lookup | Identity / Directory / Advice; `askIncumbent` + status `yield` = **directory-row** only. |
| **Migration** (C) | **this track** | Cutover, drain, state story, old-node shutdown via **node** control plane, contract gate. |
| **Clients** (D) | later | Dialer reconnect / redirect — open; `contractHash` / verify is substrate, not the client story. |

**Build on (shipped):**
- B Directory `askIncumbent` + NodeStatus `yield` / `ListenOptions.onYield` — **directory-row** replace only (AI.4: no in-flight drain).
- A Launcher custody + `Node.assume` + Ready / `withReadiness` / `Node.status`.
- F4 `contractHash` + deep `verifyConnection` → `ContractMismatch` (binary; redeploy stale side).
- WorkPool local `shutdown` / `phase: "draining"` + `release` / `enqueue` / `releaseEncoded` (app-level queue transfer primitives).
- Stores: **one store per Node** (not shared cross-node durability) — [`stores.md`](../guides/stores.md).

**Gone / do not invent lightly:** `HandoffManager`, parallel Directory, launcher-owned migration, Lookup.assign / blank-worker migrate.

**Gaps vs full C:** no dual-serve / client redirect (Track D). **Shipped:** #27 membership push; #31 `phase` + `Node.drain` + yield fail-closed; #32 `Node.shutdown` / `launch` + peersLayer rebind; #39 serve-site `{ handoff }` fn (retires #33 `withHandoff`); #34/#39 WorkPool peer transfer (`WorkPool.releaseEnqueueHandoff`).

### Track C — deferred bake (owner-confirmed deferred; #35–37)

**No Eng on #35–37 until re-locked** (gate #2). #28–34 are Locked above. Owner rubber-stamped deferral 2026-07-29.

35. **Version / contract gate = reuse `contractHash` + `ContractMismatch` (binary); no negotiation ranges in C v1.** *(deferred — reuse shipped drift detect; no C Eng needed until ranges are wanted)*
    - Drift detect stays the loud-failures ladder (`ContractMismatch` — redeploy the stale side).
    - C does **not** invent compatibility windows or multi-hash negotiation.

36. **Lookup-node handoff = explicitly deferred (not special-cased in C v1).**
    - Soft-bake / IPC Lookup topology stays B.
    - Migrating the Lookup node itself is out of C v1; treat later as “any node” once C verbs exist.

37. **Track D boundary — C emits signals only; no client redirect API in C.** *(confirmed; `lookupClient` / `peersLayer` rebind already Eng'd on D substrate)*
    - **C ships:** draining status, drain-then-cut, WorkPool peer transfer (#34), Node shutdown sequence, Directory/Advice composition.
    - **C does not ship:** client redirect, dual-serve dial sticky, reconnect SDKs.
    - **Minimal C→D signals (reuse):** `Directory.changes` / `nodesServing`, Advice prefer/clear, `Node.status` (phase / ownership / readiness), per-service `contractHash`.
    - Track D owns how dialers react (incl. peer hot-rebind on `dialChanged`).

**Rejected for C v1 (record):** dual-serve cutover; client redirect; shared Store; contract compatibility ranges; Lookup.assign / blank-worker migrate; Launcher as migration owner; `HandoffManager` noun; automated A/B launcher mode (explicit launcher later).

**Exit for Eng (remaining Locked):** none — #27–34 Eng'd. #35–37 deferred; Track D redirect / dual-serve still open.

---

## Owner framing (read this first)

### Launcher — expect to start over

Prior notes (`launcher-decisions.md`, Agent F bake) are **reference only**. Treat every “Locked” / “Proposed” row there as **historical opinion**, not binding. You are **just as likely to redesign from scratch**. Do not Eng launcher APIs off that doc without a fresh owner bake.

### Contract drift detection — solid (keep)

F4 / `contractHash` / default-on verify / loud-failures taxonomy **shipped** (Agent E design → Agent 3 Eng). Prefer **reuse** over reinventing. See:

- [`loud-failures-design.md`](./loud-failures-design.md)
- [`verify-connection-classification.md`](./verify-connection-classification.md)
- `Hyperlink.contractHash`, `ContractMismatch`, per-HyperService `contractHash` on node status readiness rows

That stack answers: *“client and server disagree on the wire contract → fail loud.”*  
It does **not** answer cross-version state migration or zero-downtime handoff.

### Prefer existing concepts

**Do not invent new concepts unless they are really, really good.** Prefer `Group`, `Node`, Lookup (`Identity` / `Directory` / `Advice`), `Layer` / `Scope` / `Schedule`, Daemon machinery, existing serve/client surfaces. New nouns need a high bar and owner approval.

---

## Direction the owner wants explored (not locked — discuss)

### 1. Dumb launcher, then exit

- Launcher’s job is **bring-up only**: spawn process(es), then **exit when that job is done**.
- It is **relatively dumb** — not a long-lived supervisor owning the fleet forever.
- Ongoing control lives on **nodes**, especially the **Lookup node**.

### 2. Daemon ownership = the Node

- **As soon as a process starts, it is owned and controlled by the nodes.**
- All process controls (shutdown, drain, restart signals that matter, etc.) go **through the node** — not through a lingering launcher daemon.
- Launcher does not remain the control plane after spawn.

### 3. Lookup directs startup

- When a node goes through startup, the **lookup node tells it what to do** (placement / role / whether to take over, etc. — exact verbs TBD; reuse Lookup surfaces where possible).
- Launcher is not the brain after spawn; Lookup is.

### 4. Version upgrade → handoff

- If the new node is an **updated version of an existing node**, a **handoff** is triggered.
- Each service that **supports** handoff opts in via serve `{ handoff }` (or toolkit config). **WorkPool** always bakes `releaseEnqueueHandoff` on `serve` / `serveRemote`.
- When handoffs complete, the **old node** leaves via `Node.shutdown` (drain → handoffs → Advice clear → Directory unregister → listen exit) — not launcher kill.
- Mission framing (goal + open problems; Track C #27–34+#39 Eng'd): [`node-handoff-mission.md`](./node-handoff-mission.md).

### 5. Clients during handoff — open

How **clients** handle node handoff (redirect, dual-serve, drain, retry, discovery) is a large open discussion. Capture options; do not pretend it’s solved. Drift detect (`contractHash`) is substrate, not the full client story.

---

## Reference corpus (non-binding except drift Eng)

| Doc | Use as |
|-----|--------|
| [`launcher-decisions.md`](./launcher-decisions.md) | Prior bake notes — **reference only, not locked** |
| [`node-handoff-mission.md`](./node-handoff-mission.md) | Mission boundaries + hard problems — **not a decisions bake** |
| [`loud-failures-design.md`](./loud-failures-design.md) | Drift / verify — **Eng’d, prefer keep** |
| [`verify-connection-classification.md`](./verify-connection-classification.md) | Deep verify ladder — **Eng’d** |
| [`identity-coordinator.md`](./identity-coordinator.md) + guide | Lookup / identity — shipped control loop to lean on |
| [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) | Catalog / discovery context |

---

## Suggested first moves

1. ~~Framing / A+B / lock #27–34+#39 / Eng / peersLayer + lookupClient rebind / serve-site `{ handoff }` + `releaseEnqueueHandoff` + live A→B suite~~ — done.
2. **Owner later:** explicit A/B launcher; re-lock #35–37 if Eng wanted; Track D redirect / dual-serve; `restartSuccessor`.
3. ~~Track D `lookupClient` hot-rebind~~ — Eng'd (with directory `peersLayer`).

**Live cutover SSOT:** `test/handoff-ab-cutover.test.ts` (B Directory-visible first; peer by dial; same-`nodeKey` + `askIncumbent` variants). Unit/orchestration: `test/hyperlink-handoff.test.ts`.

---

## Out of scope for this brief

- Dashboard / `View` registry redesign (Agent G).
- Reopening named-handles / Soft storage tracks.
- Treating `launcher-decisions.md` “Locked” rows as approved for implementation.

---

## Short prompt (paste to new agent)

```
Read docs/handoffs/launcher-and-handoff-brief.md carefully.

You own launcher + node handoff (Agent 5). Track A+B and Track C Locked
#27–34+#39 are Eng'd on tip:
  - Launcher custody; Directory.changes; Node.drain/shutdown/launch
  - peersLayer + lookupClient hot-rebind
  - serve-site handoff(from,to,ctx) on Hyperlink.serve (Locked #39)
  - WorkPool.serve/serveRemote always bake releaseEnqueueHandoff
  - live A→B suite: test/handoff-ab-cutover.test.ts

Retired: withHandoff / handoffOf / HandoffStrategy / workPoolRelease tag strategy.
Replacement addressing: same nodeKey + new dial; no automated A/B launcher yet.
launcher-decisions.md stays reference-only if redesigning Track A further.

Contract drift (contractHash / verify / loud-failures) is solid — reuse it.

Next: do NOT Eng deferred #35–37 until re-locked. Track D redirect /
dual-serve, restartSuccessor, and explicit A/B launcher still open.
Plan-first; no new nouns unless really good.
```
