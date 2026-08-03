# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + DaemonStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](archive/2026-07/features/whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **4** | `cursor/hyperservice-open-deps-5679` | [gap proposals](./examples-gap-proposals.md) · [E5 apps](./examples-apps-e5-plan.md) · [release cleanup](./release-prep-cleanup.md) | **tip-synced** — examples + release-prep cleanup | same tip as `integration` | Related 97/97; archive pass | Idea 10 E5 owner-gated; changeset consolidate owner | 2026-07-29 |
| **G / TUI** | `cursor/file-router-prototype-125f` | [page-layout design](./page-layout-design.md) · [file-router](./file-router-prototype.md) · [codesplit](../plans/last-ts-codesplit.md) | **Design** — Page/Layout/Last.provide plan drafted; View gen Eng’d | work tip | last-ts tsc + view suites | Owner lock page-layout API; then L0 Eng; createPages + tip-sync later | 2026-08-03 |
| **Hygiene** | merged to `integration` | branch tidy + `hyp` land + landing polish | **landed** | same tip as `integration` | typecheck + lint (env: suite needs newer Node `node:sqlite` backup) | Active agents: **4**, **5**, **G** | 2026-07-26 |
| **5** | `cursor/lifecycle-defer-start-929b` | [launcher brief](./launcher-and-handoff-brief.md) · [Versioned](./versioned-schema-decisions.md) · [Lifecycle](../guides/lifecycle.md) | **Lifecycle closed**; Versioned locked — Eng on go; `.deprecated` (dual/pipe) + update-impact **planned, deferred** | same tip as `integration` | Lifecycle suites green on tip | Next Eng: Versioned only; deprecated + impact after | 2026-08-03 |
| **Docs site** | `cursor/docs-site-edge-cache-dbdc` (ε) | [dev host](./docs-site-dev-host.md) · edge cache · SEO | **tip-synced / live** — apex coming-soon; docs on `dev`; GS polish; origin gate | same tip as `integration` | smoke + host-gate tests; CF + `serve-production.mjs`; islands on `hyperlink-ts` / `.hl-dashboard` | — | 2026-07-29 |
| **1** | *(frozen)* | [Examples book](./agent-01-examples-book.md) · [Phase 3](./archive/2026-07/agents/agent-01-docs-corpus-phase3-plan.md) | **frozen / superseded** — E1 examples on tip; intro voice [#68](https://github.com/nikolasstow/Hyperlink/pull/68) closed | — | — | Branch deleted (unique tip was pre-rebrand `docs/index.md`) | 2026-07-26 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](archive/2026-07/agents/agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | *(dead)* | [identity-coordinator](./identity-coordinator.md) · [loud-failures](./loud-failures-design.md) | **dead** — Soft / verify / F4 / lineId memo Eng’d on tip | — | — | Work branch deleted (was tip-contained in `integration`) | 2026-07-26 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](archive/2026-07/agents/agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 + M1b on tip** | `integration` tip | typecheck / lint / tests green (at land) | **Hover:** `yield* Emails` → **`WorkPool<EmailJob>`**; Gate → **`Gate<…>`** (`Svc` on `HyperlinkTag` + `nameQueueService` / `nameRunService`). **Not** `QueueResource` / public `QueueHandle`. Follow-ups: M2 `.Service` unify, carriers, trailing defaults, prettify asymmetry, Daemon naming, M4–M6. Public `QueueHandle` export removed (internal TEMP only). Do not reassign to Agent 3 | 2026-07-27 |
| **E** | folded into Agent 3 work branch | [impossible-states](./archive/2026-07/features/impossible-states-proposal.md) · [loud-failures](./loud-failures-design.md) | **merged to tip** | `integration` | F1–F4 + default-on verify Eng’d | — | 2026-07-21 |

---

## Supervisor queue

### Reserved — hands off (2026-07-16, owner-assigned)
0. **Agent E:** impossible-states plan ([`impossible-states-proposal.md`](./archive/2026-07/features/impossible-states-proposal.md)). **DONE + merged:** P1 (node↔protocol wiring bug → compile error, cast-free) + P5 (http transport dies in browser). **P2 SKIPPED** (cast). **P4 already-enforced** (loose-fields payload already rejected; proposal mis-scoped). **P3 deferred** (opaque serve layers). Clean wins complete. Reserved `src/Hyperlink.ts` node/client surface until fully merged (done). **Tag-config reservation RELEASED — Agent D WorkPool/Gate/Daemon payload-config unblocked.**

### Active (owner approval required)
1. **Agent 4:** Examples Ideas 1–9 + Related notes Eng’d. **Release-prep cleanup Eng’d** (archive completed handoffs/plans, dead scripts, npmignore, legacy example aliases). Idea 10 Apps/E5 still owner-gated. Owner still: changeset consolidate before `version`/publish.
2. **Agent G / TUI:** last-ts P0–P3 Eng’d + View handle/`fromEffect`/`gen` on work tip; merged latest `integration`. **Need owner:** `Page.Tag` go, docs-site createPages cutover, tip-sync. P4 shims remain. Park: [`owned-string-casing-park.md`](./owned-string-casing-park.md).
3. **Agent 5 (Launcher + handoff):** **Lifecycle L0–L7 closed**. Chrome → **Agent G**. **Versioned** locked — Eng on go. **Planned after Versioned** (doc only): `Hyperlink.deprecated` as `Fn.dual` (pipe-canonical); Lookup/Node **update impact** then explicit A/B / `restartSuccessor`. Also gated: #36–37, Track D redirect. Brief: [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md).
4. **Docs site:** Live — apex coming-soon (inlined CSS + `(book)` chrome); docs on `dev`. Origin host-gate via `serve-production.mjs` (before Waku static). Islands: `hyperlink-ts` alias + `.hl-dashboard`. Getting Started em-dash/voice polish.

### Frozen / dead (do not assign)
- **Agent 1:** frozen — Examples book E1 already on tip; stale intro PR #68 closed; branch deleted.
- **Agent 3:** dead — Soft/verify/F4/memo Eng’d on tip; work branch deleted.
- **Agent D (+ peers):** named handles — do not reassign (was: do not give to Agent 3).
- **Hygiene:** landed on `integration` (`hyp` CLI + landing polish).

### Ready / owner calls
5. **Node catalog + identity lookup** — design [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md); Phase-2–3 catalog/directory/**D3**/**D4**/**D7**/`Node.Prototype` Eng on tip; **`askIncumbent` Eng’d**; **X1 Eng’d**; **managers → [`identity-coordinator.md`](./identity-coordinator.md) M4–M6 Eng’d** (v1 complete)
6. Store-layer `(scopeKey, lineId)` memo — **Eng’d**
7. Fail-loud Soft when AppStore lacks engine registration — **Eng’d**
8. `main` merge + `pnpm run version` — still deferred

### Done prior (Agent 3)
- [#62](https://github.com/NikScripts/effect-pm/pull/62) Soft bake+override (`withDefaultStorage`) — **merged**
- [#65](https://github.com/NikScripts/effect-pm/pull/65) cutover follow-through (untyped WorkPool Soft + Soft prose) — **merged**
- [#59](https://github.com/NikScripts/effect-pm/pull/59) `byHyperlink` full key + kill resource-identity `processId`/`queueId`
- [#57](https://github.com/NikScripts/effect-pm/pull/57) private `_logs`
- Daemon.events [#47](https://github.com/NikScripts/effect-pm/pull/47)/[#51](https://github.com/NikScripts/effect-pm/pull/51) · lineage [#48](https://github.com/NikScripts/effect-pm/pull/48) · ready-perfection [#52](https://github.com/NikScripts/effect-pm/pull/52)

### Deferred / parked
- **ShardMap author (Cursor):** type-safety + corpus sweep **merged** to `integration` (`f269a9ce`; was [#39](https://github.com/NikScripts/effect-pm/pull/39) / [#41](https://github.com/NikScripts/effect-pm/pull/41)). Branches deleted. Corpus-complete for Agent C remit.
- Headlining resource research — **shipped** as Telemetry fleet + ShardMap (#32/#39/#41); Agent 1 moved to docs corpus
- Agent B dashboard type-safety (plan-first) — **UI reserved for lettered agents**
- Agent C standards audit (plan-first)

### Branch hygiene (2026-07-26)
Owner: only **Agent 4**, **Agent 5**, and **Agent G** remain active.

**Deleted (superseded / contained):** Agent 1 `cursor/docs-corpus-phase3-ce05` (+ closed [#68](https://github.com/nikolasstow/Hyperlink/pull/68)); Agent 3 `cursor/logs-store-followers-plan-906e` + `cursor/agent-03-byhyperlink-full-key-a009`; plus earlier contained tips (`ask-incumbent`, catalog bake stack, `feat/*` tip-contained, etc.).

**Merged onto tip (this hygiene branch):** repo `hyp` CLI (was [#78](https://github.com/nikolasstow/Hyperlink/pull/78) / `cursor/repo-dev-cli-125f`); landing polish from `docs/standards-corpus`.

**Archived remotes (keep tip, do not land as-is):**
- `archive/command-auth` — CommandAuth stack (legacy removed on tip)
- `archive/dashboard-readiness` — was `feat/dashboard-readiness` (deck-pack / pollAtom era; needs G-era rebase)
- `archive/resource-toolkit-web-widgets` — was `rewrite/resource-toolkit`; handoff copies under [`archive/2026-07/widgets/`](./archive/2026-07/widgets/)

**Left active:** `cursor/hyperservice-open-deps-5679` (4), `cursor/tui-dashboard-parity-125f` (G), `cursor/docs-site-edge-cache-dbdc` (docs site), `main`, `integration`. Tip-contained remotes deleted in release-prep cleanup; unique non-ancestor tips kept under `archive/*` or listed in [`release-prep-cleanup.md`](./release-prep-cleanup.md).

---

## Completed

- [#65](https://github.com/NikScripts/effect-pm/pull/65) Soft cutover follow-through (untyped WorkPool Soft + Soft prose)
- [#62](https://github.com/NikScripts/effect-pm/pull/62) Soft bake+override Memory (`withDefaultStorage`)
- [#60](https://github.com/NikScripts/effect-pm/pull/60) FleetHealth — meshed stadium-board readiness (`Reachable` / `Unreachable`)
- [#55](https://github.com/NikScripts/effect-pm/pull/55) Phase 1 handoffs archive A–D + open-asks closeout
- [#54](https://github.com/NikScripts/effect-pm/pull/54) withReadiness pipe type hygiene (P0–P3)
- [#52](https://github.com/NikScripts/effect-pm/pull/52) Agent 3 ready-perfection handoff close-out
- [#50](https://github.com/NikScripts/effect-pm/pull/50) Logs guide (narrative chapter after Stores)
- [#51](https://github.com/NikScripts/effect-pm/pull/51) Daemon.events remote proof (A+B+C1) + Completed.success coverage
- [#48](https://github.com/NikScripts/effect-pm/pull/48) Logs lineage append in `withScope` (idempotent leaf)
- [#47](https://github.com/NikScripts/effect-pm/pull/47) Process live `events` stream (persist == stream)
- [#43](https://github.com/NikScripts/effect-pm/pull/43) Remove interim `Logs.persistLayer` + standalone `LogStore` / `store/Log` subpath
- [#40](https://github.com/NikScripts/effect-pm/pull/40) Durable store tails — `Node.logs`, registration followers, Storage-first reads, stream levels, remote NodeStatus path
- [#33](https://github.com/NikScripts/effect-pm/pull/33) Logs closeout — `NodeLogs` shim removed; Agent 2 retired
- [#30](https://github.com/NikScripts/effect-pm/pull/30) Phase 5 Logs — `captureLogs` / handle `logs` removed
- DaemonStorage / RuntimeStorage / ProcessLifecycleStore facet substrate **retired**
- [#26](https://github.com/NikScripts/effect-pm/pull/26) Process `run` RPC + effect/effectFn
- [#23–#25](https://github.com/NikScripts/effect-pm/pull/23) queue ref + node status + tag schemas

---

## Session log index

Detailed logs live in each handoff file under `### Session log …`.
