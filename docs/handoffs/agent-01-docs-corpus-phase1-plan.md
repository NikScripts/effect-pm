# Agent 1 — Phase 1 plan: handoffs cleanup inventory

**Status:** **PLAN LOCKED (posture) — batch execution deferred to owner** (2026-07-14).  
**Owner steer:** thorough · precautionary · **defer edge cases / deletes / ambiguous moves to owner**.  
**Assignment:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) Phase 1.  
**Branch:** `cursor/docs-corpus-phase1-plan-ce05`.  
**Scope:** `docs/handoffs/**` only. **Out of scope:** `docs/site/**`, Twoslash/UI chrome, `src/web` / `src/ui`, Phases 2–3.

Inventory below stands. **No mass moves until owner unlocks a named batch.**

---

## Locked execution rules (owner 2026-07-14)

1. **Archive ≫ delete.** First pass(es) = archive only. Deletes need per-row owner ticks.
2. **When unsure → leave in place** and list under **Deferred for owner** (do not invent fates).
3. **External citations block casual moves** — anything linked from `AGENTS.md`, `docs/legacy/**`, or `docs/site/README.md` stays put until a move PR also fixes those links **and** owner OK’d that batch.
4. **Active bus + open briefs** stay at root (`agent-status`, `owner-decisions`, `supervisor-protocol`, `local-agents`, live Agent 1/3/B/C/D files).
5. **Historical SSOT** (`*-decisions.md`, store-cutover set cited by STORAGE, etc.) stay at root until Phase 3 / explicit unlock.
6. Propose work as **batches**; owner says which batch to run.

---

## Proposed batches (awaiting unlock)

| Batch | What | Risk | Status |
|-------|------|------|--------|
| **0 — posture only** | This plan + owner-decisions steer | None | **done in docs** |
| **A — date-stamped orphans** | `2026-06-29-*`, `2026-07-01-*` … `2026-07-07-*` with **zero external inbound** → `archive/YYYY-MM/` | Low | **blocked on owner** |
| **B — merged agent closeouts** | Done Agent 1/2 / cursor closeouts with no legacy/AGENTS links | Low–med | **blocked on owner** |
| **C — shipped feature handoffs** | ApiMetrics, CQR, telemetry design, etc. (still no/legacy-only links) | Med | **blocked on owner** |
| **D — reports bodies** | Archive five `reports/2026-07-07-*`; keep `reports/README`; rewrite AGENTS/legacy links | Higher ripple | **blocked on owner** |
| **E — SSOT / store-cutover / decisions** | Relocate or `decisions/` layout | High | **owner design first** |
| **Z — deletes** | Only ticked rows | Irreversible (git recoverable) | **owner ticks required** |

---

## Deferred for owner (do not move without you)

- Whether to use a root `decisions/` folder (alt B) vs keep decisions flat  
- `store-cutover-*.md` + `store-and-logs-design.md` while STORAGE/legacy still cite them  
- `agent-03-logs-store-followers-plan.md` / `agent-03-log-store-tail-plan.md` (active vs archive-now)  
- `store-layer-query.md` (parked not-approved at root vs archive+banner)  
- `queue-persistence-design.md`, `queue-nonserializable-items.md`  
- Any **delete** candidates  
- Letter-agent docs (`agent-b-plan`, docs-platform decision) linked from `docs/site/README.md`

---

## Method

- Enumerated **94** markdown files under `docs/handoffs/` (88 root + 6 under `reports/`).
- Cross-checked **inbound links** from `AGENTS.md`, `docs/legacy/**`, `docs/standards/**`, live book roots, and in-handoffs refs.
- Classifications below remain **proposals** until a batch is unlocked.

---

## Proposed fate vocabulary

| Label | Meaning |
|-------|---------|
| **active** | Needed for open / parked work or the live supervisor bus. Stays at `handoffs/` root (or current role path). |
| **historical SSOT** | Shipped / locked decisions that remain citable. Prefer keep at root **or** move only with a one-line stub + link fix. |
| **archive** | Finished agent work, audits, date-stamped findings. Move under `handoffs/archive/…`; keep git history. |
| **delete** | Superseded noise or duplicate closeouts with no unique content once pointers exist. **Owner must approve each.** |

Default bias: **archive over delete** for anything that might explain a past PR.

---

## 1. Inventory (grouped)

### A. Keep forever at root — **active** bus

| Path | Role | Fate | Evidence |
|------|------|------|----------|
| `agent-status.md` | Supervisor dashboard | **active** | Cited by AGENTS / every agent brief |
| `owner-decisions.md` | Locked steers log | **active** | Explicit keep-live in corpus brief |
| `supervisor-protocol.md` | How supervision works | **active** | Keep-live list |
| `local-agents.md` | Local Claude prompts/protocol | **active** | Letter agents + protocol |
| `agent-01-docs-corpus.md` | This track’s assignment | **active** | Open Agent 1 work |
| `agent-01-docs-corpus-phase1-plan.md` | This plan | **active** | Until Phase 1 executes, then fold/archive |

### B. Active / parked agent briefs — **active**

| Path | Role | Fate | Evidence |
|------|------|------|----------|
| `agent-03-logs-p1.md` | Agent 3 logs intent (followers shipped; follow-ups) | **active** | Status board + #40/#43 |
| `agent-03-logs-store-followers-plan.md` | Followers implementation plan (shipped, still referenced) | **active** → later **archive** after owner agrees P1 absorbed | Still linked from status / P1 brief |
| `agent-03-log-store-tail-plan.md` | Durable tail redesign | **active** | New on tip; Agent 3 track |
| `agent-d-named-handles.md` | Named handles + M2/M3 follow-ups | **active** | Board: M3 shipped, follow-ups open |
| `queue-handle-convergence-decisions.md` | Handle convergence SSOT | **historical SSOT** (+ active for D) | Cited by Agent D brief / board |
| `agent-b-dashboard-typesafety.md` | Dashboard type-safety (plan-first) | **active** | Board plan-first; **content only** — no site UI from Agent 1 |
| `agent-b-plan.md` | Docs app shell contract | **active** / lettered | Linked from `docs/site/README.md` |
| `agent-b-html-doc-platform.md` | Bespoke docs shell brief | **active** / lettered | Site track (Agent 1 must not execute site work) |
| `agent-c-standards-audit.md` | Standards audit (plan-first) | **active** | Board plan-first |
| `agent-a-rules-and-documentation.md` | Rules/docs corpus (merged) | **archive** (or keep root until A quiet) | Merged; low urgency |
| `agent-a-phase1-inventory.md` | Rule inventory | **archive** | Feed for standards; history |
| `agent-a-html-standards-corpus.md` | HTML/Tailwind standards (local) | **active** / lettered | If still open for A; else archive |
| `agent-a-type-display-cleanup.md` | Type-display backlog note | **archive** or **historical SSOT** | Much shipped; backlog may remain |

### C. Decision / design SSOTs — prefer **historical SSOT**

| Path | Role | Fate | Evidence |
|------|------|------|----------|
| `multi-host-instances-decisions.md` | Multi-host locked decisions | **historical SSOT** | Referenced from legacy beta migration notes |
| `multi-host-instances.md` | Theoretical exploration | **archive** | Explicitly theoretical; decisions file is SSOT |
| `store-transforms-fullcapture-decisions.md` | Store transforms locked | **historical SSOT** | Marked shipped; useful for archaeology |
| `store-shape-streams-decisions.md` | Nested shapes / streams | **historical SSOT** | Stated approved; shape model still relevant |
| `store-and-logs-design.md` | Early Store + logs design | **historical SSOT** | Linked from `docs/legacy/guides/store*.md` |
| `store-cutover-00-store-core.md` | Cutover shared decisions | **historical SSOT** | Linked heavily from `docs/legacy/STORAGE.md` |
| `store-cutover-process.md` | Process cutover | **historical SSOT** | Linked STORAGE + process guide; status done |
| `store-cutover-queue.md` | Queue cutover | **historical SSOT** | Linked STORAGE |
| `store-cutover-runresource.md` | RunResource cutover | **historical SSOT** | Linked STORAGE |
| `store-cutover-customqueue.md` | CQR cutover | **archive** (or SSOT if still unique) | Mostly handoff-internal refs |
| `result-schema-and-rpc-validation.md` | Tag wire schema names | **historical SSOT** | Linked STORAGE |
| `docs-platform-architecture-decision.md` | Docs platform Option 6 | **historical SSOT** / lettered | Linked `docs/site/README.md` |
| `queue-persistence-design.md` | Queue persistence design | **archive** or **historical SSOT** | Partially superseded by presence-driven durability — owner call |
| `per-resource-dependency-serve-design.md` | Serve dependency design | **archive** | Shipped era; beta.18 context |
| `service-shape-redesign.md` | Service shape redesign | **archive** | Shipped |
| `telemetry-design.md` / `telemetry-resource.md` | Telemetry design / handoff | **archive** | Telemetry shipped (#32) |
| `dynamic-config-surface.md` / `dynamic-config-requirements.md` | DynamicConfig shipped notes | **archive** or thin stub → guide later (Phase 3) | Module on integration; no external links today |
| `store-layer-query.md` | Layer query (informational / not approved) | **active** as “parked / not approved” **or** **archive** with not-approved banner | Board: not approved |
| `store-migration-roadmap.md` | Store migration roadmap | **archive** | Cutover largely done; useful timeline |
| `whats-changed-2026-07-13.md` | Base-branch recap | **archive** after dated (or keep through July) | Orienting doc; eventually archive |
| `queue-nonserializable-items.md` | Low-priority TODO | **active** (backlog note) **or** **archive** | Explicit TODO — owner call |

### D. Merged agent closeouts — **archive**

| Path | Role | Fate | Evidence |
|------|------|------|----------|
| `agent-01-next-headlining-resource.md` | Headlining research | **archive** | Shipped Telemetry+ShardMap; Agent 1 moved |
| `agent-01-telemetry-prototype-and-shardmap.md` | Pitches | **archive** | Status implemented |
| `agent-01-session-2-storage-docs.md` | Storage docs sweep | **archive** | Session done |
| `agent-01-store-cutover-closeout.md` | Store close-out | **archive** | Checkboxes done |
| `agent-02-logs-platform-plan.md` | Logs platform plan | **archive** | Agent 2 retired; #33 |
| `agent-02-process-closeout.md` | Process close-out | **archive** | Merged era |
| `agent-02-process-run-rpc.md` | Process `run` RPC | **archive** | #26 MERGED |
| `agent-02-queue-wire-phase-1a.md` | Queue wire 1a | **archive** | #21 |
| `agent-02-session-2-process-platform.md` | Process platform session | **archive** | Done |
| `agent-02-branch-cleanup.md` | Branch cleanup notes | **archive** | Done |
| `agent-cursor-shardmap-typesafety.md` | ShardMap type-safety | **archive** | #39/#41 merged |
| `agent-cursor-logs-store-cutover.md` | Logs store cutover (Cursor) | **archive** or **delete** | Superseded by Agent 3 followers / #40/#43 — prefer archive + “superseded by …” |
| `agent-qr-handle-ref.md` | QR handle status ref | **archive** | #23 era |
| `agent-engine-handle-display-types.md` | Engine display types | **archive** | Overlaps Agent D / type-display |
| `branch-cleanup-manifest.md` | 2026-07-09 cleanup | **archive** | Historical hygiene |
| `integration-sync-2026-07-07.md` | Sync note | **archive** | Point-in-time |
| `phase5-logs-migration-review.md` | PR #30 review | **archive** | Absorbed into LOGS / whats-changed |
| `process-store-cutover-review.md` | Process cutover review | **archive** | Done |
| `run-resource-hardening-review.md` | RunResource review | **archive** | Done |

### E. Date-stamped findings / wow-sports / beta audits — **first stack**

Owner rule (2026-07-14): one stack at a time; **complete → delete**, unfinished → **defer**.

| Path | Fate |
|------|------|
| Date-stamped `2026-*.md` stack | **closed** — deletes + open-asks absorbs; beta22 handoff deleted (PipeableTag fix + type hygiene) |
| [`open-asks.md`](./open-asks.md) | **active** — §1 widget seam · §2 when-not-to-hoist · §3 layerNoop |

### F. Feature handoffs superseded by shipped API — **archive** (default)

| Path | Role | Notes |
|------|------|-------|
| `api-resource-metrics.md` | ApiMetrics | Shipped |
| `custom-queue-resource.md` | CQR | Shipped |
| `docs-twoslash-hover-types.md` | Twoslash types | Lettered/site; archive — **do not edit site** |
| `docs-updates.md` | Misc docs agent | Archive |
| `resource-host-health.md` | Host health | Host→Node rename era; archive |
| `resource-serverentry-for-custom-resources.md` | serverEntry report | Archive |
| `serve-apimetrics-with-group.md` | Serve ApiMetrics | Archive |
| `serveallhttp-heterogeneous-requirements.md` | serveAllHttp R pin | Archive |
| `ui-serve-all-http.md` | UI agent serveAllHttp | Archive; linked from legacy setup guide — fix link on move |
| `withreadiness-host-bound-tags.md` | withReadiness report | Archive |

### G. `reports/` bus — **keep index; archive bodies**

| Path | Fate |
|------|------|
| `reports/README.md` | **active** (index) — update after moves |
| `reports/2026-07-07-agent-report-*.md` (5) | **archive** → `archive/2026-07/reports/` **or** keep under `reports/archive/` |
| External links | `AGENTS.md`, `docs/legacy/AGENTS.md`, PACKAGE-GUIDE, STORAGE, PROCESS-API, process guide cite reports — **must rewrite** on move |

### H. Candidates for **delete** (need owner checkbox)

Only if archive is unwanted:

| Path | Why delete might be OK | Safer alternative |
|------|------------------------|-------------------|
| Duplicate closeouts once stubs exist in `whats-changed` / LOGS | Reduce noise | Archive month folder |
| Withdrawn Cursor logs-store-cutover after Agent 3 supersession note in status | One-liner in status enough | Archive |
| Pure duplicate “report” once folded into agent report | — | Archive |

**Recommendation:** Phase 1 execution = **zero deletes** unless owner ticks specific rows. Prefer `archive/`.

---

## 2. Proposed tree

```
docs/handoffs/
  README.md                         # NEW (optional): how to read this bus
  agent-status.md                   # forever
  owner-decisions.md                # forever
  supervisor-protocol.md            # forever
  local-agents.md                   # forever
  agent-01-docs-corpus.md           # active track
  agent-01-docs-corpus-phase1-plan.md
  agent-03-*.md                     # while Agent 3 open
  agent-d-named-handles.md
  agent-b-*.md / agent-c-*.md       # while plan-first
  *-decisions.md                    # historical SSOT (or decisions/)
  queue-handle-convergence-decisions.md
  multi-host-instances-decisions.md
  store-transforms-fullcapture-decisions.md
  store-shape-streams-decisions.md
  store-and-logs-design.md          # until Phase 3 absorbs into guides
  store-cutover-*.md                # until legacy STORAGE links rewritten
  result-schema-and-rpc-validation.md
  docs-platform-architecture-decision.md
  reports/
    README.md
  archive/
    2026-06/
    2026-07/
      reports/                      # optional nest
      agents/                       # optional: retired agent-0x closeouts
```

### Alternative (owner pick)

**A (recommended):** Flat root for *live + SSOT*; everything else under `archive/YYYY-MM/`.  
**B:** Also add `handoffs/decisions/` for `*-decisions.md` (cleaner root; more link churn).  
**C:** Delete aggressively after inventory — smallest tree; highest risk of losing rationale.

---

## 3. Keep-forever rules (root)

Stay at `docs/handoffs/` root **forever** (until the bus itself is redesigned):

1. `agent-status.md`
2. `owner-decisions.md`
3. `supervisor-protocol.md`
4. `local-agents.md` (or merge into supervisor-protocol later — owner call)
5. The **current** Agent 1 corpus assignment file while this track is open
6. Any brief listed on the status board as **plan-first / building / active**
7. Decision files still cited by **live** or **legacy-served** documentation (`STORAGE.md`, process/store guides, `docs/site/README.md`) until Phase 3 ports those citations into the live book

Everything else is eligible for archive once:

- Status header says merged/done/shipped, **and**
- Not in the external link set below (or links updated in the same PR).

---

## 4. Link-ripple check (must fix in same PR as moves)

### High priority (outside `handoffs/`)

| Source | Targets |
|--------|---------|
| `AGENTS.md` | `handoffs/reports/README.md` |
| `docs/legacy/AGENTS.md` | reports README + docs-release report |
| `docs/legacy/PACKAGE-GUIDE.md`, `README.md`, `PROCESS-API.md`, `STORAGE.md` | reports README; store-cutover-\*; result-schema |
| `docs/legacy/guides/store.md`, `store-backing.md` | `store-and-logs-design.md` |
| `docs/legacy/guides/process.md` | process agent report; store-cutover-process |
| `docs/legacy/guides/setup.md` | `ui-serve-all-http.md` |
| `docs/site/README.md` | `agent-b-plan.md`, `docs-platform-architecture-decision.md` (**lettered agents own site** — Agent 1 only fixes the markdown link text/path, does not change site chrome) |

### Medium

- In-handoffs: `agent-status.md` links to almost every active brief — update after each move.
- `owner-decisions.md` → corpus / Agent 3 briefs.
- Cross-links among store-cutover-\* and reviews.

### Low / none today

- Many date-stamped `2026-07-01-*` files have **zero** inbound links → cheapest archive class.
- DynamicConfig handoffs currently unlinked from legacy → archive without ripple.

### Process for execution PR(s)

1. Owner approves fate table (maybe with edits).  
2. One PR: create `archive/…`, `git mv` only **archive** rows, fix ripples, update `reports/README` + `agent-status`.  
3. Optional second PR: any **delete** rows owner checked.  
4. Do **not** touch `docs/site/src/**`.

---

## 5. Out of scope (hard)

- `docs/site/**` UI, CSS, Twoslash popover, dual-preview, Vite globs, Draft badge chrome  
- `src/web`, `src/ui`, dashboard widgets  
- Phase 2 (`docs/legacy/plans/`, plans refactor)  
- Phase 3 (legacy → live book + Draft content convention)  
- Engine / Logs / handles product code  
- Mass delete in this plan turn  

---

## 6. Open questions for owner (discussion)

1. **Archive vs delete default?** Plan recommends archive-only for first execution.  
2. **`decisions/` subdirectory?** Cleaner root vs more link churn (alt B).  
3. **Keep all `store-cutover-*.md` at root until STORAGE.md is rewritten in Phase 3?** Recommended yes.  
4. **`agent-03-logs-store-followers-plan.md`:** keep active (still cited) vs archive now that #40/#43 landed?  
5. **`store-layer-query.md`:** leave as parked-not-approved at root, or archive with banner?  
6. **`reports/`:** keep folder + index forever, only archive the five dated reports?  
7. Branch name: brief suggested `cursor/docs-handoffs-cleanup-a009`; this plan branch is `cursor/docs-corpus-phase1-plan-ce05` — rename on execute unlock if you care.

---

## 7. Counts (this inventory)

| Fate (proposed) | Approx count |
|-----------------|-------------:|
| active (bus + open agents) | ~15–20 |
| historical SSOT | ~12–15 |
| archive | ~55–60 |
| delete (optional) | 0 in first pass |

Exact counts will be locked when you annotate the tables.

---

## Stop

**Posture locked** (thorough · archive-first · defer to owner).  
**No archive/delete `git mv` until you unlock a batch** (A / B / C / D / E / Z above).

Say which batch to run (or edit the deferred list).
