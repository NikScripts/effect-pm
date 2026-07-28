# Agent status board

**Supervisor reads this file + git.** Agents update their row on every push. Owner does not relay unless overriding.

**Integration branch:** **`integration`** (formerly `integration/storage`). Type-display cleanup + `Client<T>` override + `Kind` drop + logs Phase 5 + DaemonStorage retirement + `NodeLogs` removal all folded. See [`whats-changed-2026-07-13.md`](archive/2026-07/features/whats-changed-2026-07-13.md).

| Agent | Branch | Handoff | State | Tip SHA | Verification | Gaps / blockers | Updated (UTC) |
|-------|--------|---------|-------|---------|--------------|-----------------|---------------|
| **4** | `cursor/hyperservice-open-deps-5679` | [fleet rate limiting](../plans/fleet-rate-limiting.md) · [wire groups](../plans/wire-groups-and-identity.md) · [service shapes](../plans/service-shapes.md) | **tip-synced** — R1+R2+R3+R3b on `integration` | same tip as `integration` | typecheck 0 / gate 30 | R4 HttpApiClient+ApiMetrics | 2026-07-27 |
| **G / TUI** | `cursor/tui-dashboard-parity-125f` | TUI ↔ web Dashboard Group parity · **View compose** · F5 | **Eng** — polished `views` + WorkerPool `View.only` | `c2b28d8ba` | ui-view; example card/app | Notes: [`view-tag-prototype.md`](./view-tag-prototype.md) · lock L5 done. Next: `ui.data`; Page logs/schedule. | 2026-07-28 |
| **Hygiene** | merged to `integration` | branch tidy + `hyp` land + landing polish | **landed** | same tip as `integration` | typecheck + lint (env: suite needs newer Node `node:sqlite` backup) | Active agents: **4**, **G**, Launcher | 2026-07-26 |
| **Launcher** | `cursor/launcher-handoff-design-929b` | [launcher + handoff brief](./launcher-and-handoff-brief.md) | **bake** — spine α locked; Track A API | branch tip | docs only | Dumb spawn-and-exit; **no Eng until owner locks API**. Tracks B–D after A | 2026-07-27 |
| **Docs site** | `cursor/docs-site-edge-cache-dbdc` (ε) | [origin down](./docs-site-origin-down.md) · edge cache | **tip-synced** — OOM fix + CF dep-API edge cache (`HIT`) + dotenvx | same tip as `integration` (`fdd920a77`) | `/healthz` ok; `cf:status` MISS→HIT | 1Password desktop CLI backup deferred (phone SSH) | 2026-07-27 |
| **1** | *(frozen)* | [Examples book](./agent-01-examples-book.md) · [Phase 3](./agent-01-docs-corpus-phase3-plan.md) | **frozen / superseded** — E1 examples on tip; intro voice [#68](https://github.com/nikolasstow/Hyperlink/pull/68) closed | — | — | Branch deleted (unique tip was pre-rebrand `docs/index.md`) | 2026-07-26 |
| **2** | merged via [#33](https://github.com/NikScripts/effect-pm/pull/33) | [logs plan](archive/2026-07/agents/agent-02-logs-platform-plan.md) | **retired / merged** | `integration` tip | green | Phase 5 + `NodeLogs` closeout done; P1 handed to Agent 3 | 2026-07-14 |
| **3** | *(dead)* | [identity-coordinator](./identity-coordinator.md) · [loud-failures](./loud-failures-design.md) | **dead** — Soft / verify / F4 / lineId memo Eng’d on tip | — | — | Work branch deleted (was tip-contained in `integration`) | 2026-07-26 |
| **B** | from `integration` | [dashboard typesafety](./agent-b-dashboard-typesafety.md) | **plan-first** | on line | — | Owner-gated; remote `fix/dashboard-typesafety` tip was already on line (deleted) | 2026-07-14 |
| **A** | merged | [rules/docs](archive/2026-07/agents/agent-a-rules-and-documentation.md) | **merged** | on line | — | — | 2026-07-12 |
| **C** | from `integration` | [standards audit](./agent-c-standards-audit.md) | **plan-first** | on line | manifest ✓ | Owner-gated; remote `chore/standards-audit` tip was already on line (deleted) | 2026-07-14 |
| **D** | **merged to `integration`** | [named handles](./agent-d-named-handles.md) · [convergence decisions](./queue-handle-convergence-decisions.md) | **M3 + M1b on tip** | `integration` tip | typecheck / lint / tests green (at land) | **Hover:** `yield* Emails` → **`WorkPool<EmailJob>`**; Gate → **`Gate<…>`** (`Svc` on `HyperlinkTag` + `nameQueueService` / `nameRunService`). **Not** `QueueResource` / public `QueueHandle`. Follow-ups: M2 `.Service` unify, carriers, trailing defaults, prettify asymmetry, Daemon naming, M4–M6. Public `QueueHandle` export removed (internal TEMP only). Do not reassign to Agent 3 | 2026-07-27 |
| **E** | folded into Agent 3 work branch | [impossible-states](./impossible-states-proposal.md) · [loud-failures](./loud-failures-design.md) | **merged to tip** | `integration` | F1–F4 + default-on verify Eng’d | — | 2026-07-21 |

---

## Supervisor queue

### Reserved — hands off (2026-07-16, owner-assigned)
0. **Agent E:** impossible-states plan ([`impossible-states-proposal.md`](./impossible-states-proposal.md)). **DONE + merged:** P1 (node↔protocol wiring bug → compile error, cast-free) + P5 (http transport dies in browser). **P2 SKIPPED** (cast). **P4 already-enforced** (loose-fields payload already rejected; proposal mis-scoped). **P3 deferred** (opaque serve layers). Clean wins complete. Reserved `src/Hyperlink.ts` node/client surface until fully merged (done). **Tag-config reservation RELEASED — Agent D WorkPool/Gate/Daemon payload-config unblocked.**

### Active (owner approval required)
1. **Agent 4:** W1–W3 + `default`/`defaults` + **R1+R2+R3+R3b tip-synced** ([`../plans/fleet-rate-limiting.md`](../plans/fleet-rate-limiting.md)). Next: R4 HttpApiClient Tag + absorb ApiMetrics. Incident: [`agent-04-w3-incident-2026-07-27.md`](./agent-04-w3-incident-2026-07-27.md).
2. **Agent G / TUI:** View compose + `views` / WorkerPool `View.only` Eng'd on `cursor/tui-dashboard-parity-125f` — lock [`view-compose-lock.md`](./view-compose-lock.md) (L5 done); hold kit Dashboard. Next: `ui.data`, Page logs/schedule.
3. **Launcher:** spine **α** locked (dumb spawn-and-exit). Baking Track **A** API with owner before any Eng. Brief: [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md).
4. **Docs site:** tip-synced on `integration`. Outage cleared (2GB); Cloudflare Cache Rule for `/api/effect*|platform-node*|sql-sqlite-node*` live (`override_origin`, HIT verified); dotenvx secrets in `docs/site/.env`.

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
- [#59](https://github.com/NikScripts/effect-pm/pull/59) `byResource` full key + kill resource-identity `processId`/`queueId`
- [#57](https://github.com/NikScripts/effect-pm/pull/57) private `_logs`
- Daemon.events [#47](https://github.com/NikScripts/effect-pm/pull/47)/[#51](https://github.com/NikScripts/effect-pm/pull/51) · lineage [#48](https://github.com/NikScripts/effect-pm/pull/48) · ready-perfection [#52](https://github.com/NikScripts/effect-pm/pull/52)

### Deferred / parked
- **ShardMap author (Cursor):** type-safety + corpus sweep **merged** to `integration` (`f269a9ce`; was [#39](https://github.com/NikScripts/effect-pm/pull/39) / [#41](https://github.com/NikScripts/effect-pm/pull/41)). Branches deleted. Corpus-complete for Agent C remit.
- Headlining resource research — **shipped** as Telemetry fleet + ShardMap (#32/#39/#41); Agent 1 moved to docs corpus
- Agent B dashboard type-safety (plan-first) — **UI reserved for lettered agents**
- Agent C standards audit (plan-first)

### Branch hygiene (2026-07-26)
Owner: only **Agent 4**, **Agent G**, and this agent remain active.

**Deleted (superseded / contained):** Agent 1 `cursor/docs-corpus-phase3-ce05` (+ closed [#68](https://github.com/nikolasstow/Hyperlink/pull/68)); Agent 3 `cursor/logs-store-followers-plan-906e` + `cursor/agent-03-byhyperlink-full-key-a009`; plus earlier contained tips (`ask-incumbent`, catalog bake stack, `feat/*` tip-contained, etc.).

**Merged onto tip (this hygiene branch):** repo `hyp` CLI (was [#78](https://github.com/nikolasstow/Hyperlink/pull/78) / `cursor/repo-dev-cli-125f`); landing polish from `docs/standards-corpus`.

**Archived remotes (keep tip, do not land as-is):**
- `archive/command-auth` — CommandAuth stack (legacy removed on tip)
- `archive/dashboard-readiness` — was `feat/dashboard-readiness` (deck-pack / pollAtom era; needs G-era rebase)
- `archive/resource-toolkit-web-widgets` — was `rewrite/resource-toolkit`; handoff copies under [`archive/2026-07/widgets/`](./archive/2026-07/widgets/)

**Left active:** `cursor/hyperservice-open-deps-5679` (4), `cursor/tui-dashboard-parity-125f` (G), `main`, `integration`.

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
