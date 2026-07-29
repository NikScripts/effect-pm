# Launcher — decisions doc

> **2026-07-25 — SUPERSEDED AS BINDING.** Owner: **nothing here is locked.** Treat this file as
> **reference only**; a new agent may start the launcher design from scratch. Active brief:
> [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md). Drift/`contractHash` work
> remains solid; launcher “Locked” / “Proposed” rows below are historical.

Bake started 2026-07-22 (owner + Agent F). Scope: the launcher (start/supervise the fleet's
runtimes), Group-based cohorts, and the Lookup control loop. Sits directly upstream of the
node-handoff mission (docs/handoffs/node-handoff-mission.md — delta's work after training).
Epsilon is the intended worktree for this once the design locks.

## Locked (owner-stated)

- **Launch = separate OS processes.** The launcher spawns real runtimes; in-process layer
  helpers are the complementary dev story, never the launch story. (owner, 07-22)
- **Cohorts come from the existing `Group` module** (`src/Group.ts`: named-record member tags,
  accessors, free nesting, `isGroup` tree walk). The launcher expands on Group — helpers, layer
  builders — it does not invent a parallel grouping concept. (owner, 07-22)
- **Lookup nodes stay in the control loop.** Their control surface is load-bearing:
  `Identity.claim` first-wins arbitration with dead-incumbent replacement (NodeStatus-ping
  checked by the Lookup node), `Directory.advertise`/`unregister`/`nodesServing` with
  `IncumbentAlive` guard, and the `Advice` service (`advise`/`clearAdvice`/`preferred`) for
  placement steering. The launcher reads and drives these — it never builds a parallel
  directory. (owner, 07-22)
- **Everything after spawn is in scope**: readiness gating, log custody, supervision/restart,
  discovery integrity (proactive `unregister` on kill), graceful drain, orphan story, dev
  watch mode. Spawn is the easy 10%. (owner, 07-22)
- **`Node.status`** is the status surface name (fold shipped 07-22; accessor-demotion step
  may follow per the rebrand doc).

## Proposed, awaiting owner go (do NOT build until approved)

- **Fleet-as-Layer**: a running node is a `Scope`-bound resource (acquire = spawn + readiness,
  release = SIGTERM/drain/SIGKILL); the running fleet is a `Layer`; `hl up` ≈
  `Layer.launch(Fleet.launch(fleet))`. The launcher has NO lifecycle model of its own — Scope
  is the lifecycle model. Consequence to accept: "restart one node" is modeled as a scoped
  sub-region, not an imperative verb.
- **Restart policy = `Schedule` values** (no bespoke policy config object); flap detection is
  Schedule composition.
- **Supervision strategy per Group subtree**, OTP-style (`one_for_one` / `one_for_all` /
  `rest_for_one`) — the nested Group tree IS the supervision tree.
- **Group layer helpers**: `Group.serve(G, node)` / `Group.connect(G, node)` /
  `Group.layer(G, impls)` where `impls` mirrors the member-record tree structurally and the
  type system enforces complete coverage. Mixed placement by composing subtree calls.
  (Layer memoization makes overlapping groups safe — same Tag provided twice dedupes.)
- **Identity injection**: launcher spawns ONE shared entry with the node name injected
  (env/argv); `assembleNode` builds that node. No per-node entry files.
- **CLI naming**: public brand / future launcher bin **`hyperlink`** with alias **`hl`**
  (pnpm/`pn` pattern). Locked 2026-07-24 (owner). `link` stays rejected (POSIX `link(1)`).
  Today that name is examples + tooling only — there is **no** shipped `hyperlink` bin yet.
  Apps wire `Hyperlink.cli(Group|record, name)` into Effect CLI; bare paths open the TUI when
  `hyperlink-ts/tui`'s `layer` is provided (`Tui` via `serviceOption`), full
  `<resource> <action>` paths run-and-exit. Private repo-dev gates are a **separate** bin
  **`hyp`**.
- **CLI targets from group paths**: nested record names give addressable paths
  (`Ops.Jobs.Counter` → `hl up ops.jobs`).
- **Deploy sequence** (later, with delta's handoff): spawn new → readiness → `Advice.advise`
  steer → drain old → `unregister` → `clearAdvice`. The routing half already exists as Lookup
  verbs; delta supplies in-flight cutover.
- **Spawn machinery**: reuse the Daemon hyperlink machinery (spawn, restart, status,
  log streaming) rather than new infra.

## Open questions (bring to the table, don't solve silently)

1. Bring-up of the Lookup node itself (`hl up` starts it first vs verifies an external one) —
   and the coordinator-handoff problem (updating the Lookup node) which needs its own design.
2. Orphan/reattach: children surviving a dead launcher is a feature (independent processes);
   re-adoption on the next `hl up` should lean on `Identity.claim`/`IncumbentAlive` arbitration
   rather than pid files. Shape TBD.
3. What serving "a group qua group" means — current lean: nothing; groups stay compile-time
   organization, helpers only touch leaves.
4. Remote machines: resident `hl agent` (itself a served Hyperlink) — direction well received,
   explicitly later than local v1.
5. Whether `serve`/`connect`/`layer` live on the group class or as `Group.*` namespace
   functions.
6. Dev mode: `hl dev` folding the same fleet declaration into one process (placement
   collapsed) — attractive, not yet discussed in depth.

## Do not resurrect

- A second source of truth for placement inside the launcher (a launcher-owned registry) —
  rejected 07-22; Lookup's Directory is the truth.
- Groups as control multiplexers (the killed ProcessGroups shape) — cohorts and layer
  ergonomics only.
- Marketing-driven API swings without grounding in the technology (owner: "We have higher
  standards for APIs" — start from Scope/Layer/Schedule/Group, not product verbs).
