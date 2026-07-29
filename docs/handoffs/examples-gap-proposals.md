# Examples gap proposals — expand one idea until covered

**Status:** **Eng’d** (2026-07-29) — Ideas 1–9 topic forms shipped; Idea 10 (Apps/E5) still owner-gated.  
**Branch:** `cursor/hyperservice-open-deps-5679` (tip-synced with `integration`).  
**Method:** pick **one idea** → ship/teach until that idea’s guide recipes have 1-file forms → next idea.  
**Not this doc:** E5 apps Twoslash (owner lock [`examples-apps-e5-plan.md`](./examples-apps-e5-plan.md)); View/Dashboard skins (Agent G).

Hub today: [`docs/examples.md`](../examples.md). Tree: [`examples/README.md`](../../examples/README.md).

---

## How to walk this

1. Owner picks or confirms the next **Idea** below.  
2. Agent expands that idea only: add `examples/<topic>/<name>.ts` + hub pair + `example:<topic>-<name>` + Twoslash include.  
3. Idea is **covered** when the missing list for that idea is empty (or owner parks leftovers).  
4. Then the next idea.

Prefer **guide-aligned topic folders**. One teachable recipe per file.

---

## Idea queue

### Idea 1 — WorkPool ← **start here**

**Why first:** Largest living guide ([`work-pools.md`](../guides/work-pools.md)); hub only has two forms.

| Status | File |
|--------|------|
| **Eng’d** | all listed expansions under `examples/work-pool/` (10 forms) |

**Covered:** yes.  
**Guides:** [`work-pools.md`](../guides/work-pools.md), Soft bits in [`stores.md`](../guides/stores.md).  
**Blocked:** none for 1-file forms.

---

### Idea 2 — Logs

**Why next:** Full guide ([`logs.md`](../guides/logs.md)); **no** `examples/logs/` topic (only buried in apps).

| Missing | Teach |
|---------|--------|
| `live-bus.ts` | `Logs.layer` + `stream` / `snapshot` |
| `node-journal.ts` | `Node.logs` on `Store.Service` + `Logs.byNode` |
| `hyperlink-logs.ts` | `Hyperlink.logs(tag).stream` / `.query` |
| `lineage-scope.ts` | `Logs.withScope` + `LogEntry` predicates |
| `levels.ts` | stream level vs durable level |

**Blocked:** none.

---

### Idea 3 — Store (toolkit planes)

**Why next:** Hub `memory` / `sqlite` teach **custom** contracts; Soft / multi-reg / History from [`stores.md`](../guides/stores.md) are still prose/apps.

| Missing | Teach |
|---------|--------|
| `soft-override-work-pool.ts` | AppStore into `WorkPool.layer` Soft unwrap |
| `one-store-many-regs.ts` | `Node.logs` + `WorkPool.store` + `Daemon.store` one journal |
| `durable-and-soft.ts` | durable backlog vs Soft journal contrast |
| `history-presence.ts` | HistoryStore omit vs provide |
| `loud-missing-registration.ts` | Soft fail when override store omits engine reg |

**Blocked:** none (Redis stays tests + existing gate fleet form).

---

### Idea 4 — Observe (+ Hyperlink atom)

**Why next:** Recipe table in [`observe.md`](../guides/observe.md); hub has one mock `pack-demo` (not Twoslash-paired).

| Missing | Teach |
|---------|--------|
| `work-pool-pack.ts` | `Observe.bind` + real `WorkPoolView.pack` |
| `recipes.ts` | `atom` / `query` / `fn` / `poll` |
| `scan-fold.ts` | capped history + accumulator |
| `hyperlink-atom.ts` | `Hyperlink.atom` / `.query` / `.fn` (or under `examples/hyperlink/`) |
| `daemon-pack.ts` / `gate-pack.ts` | family packs |

**Blocked:** React `Observe.use` / RuntimeProvider → E5 / Agent G; keep non-React `bind` here.

---

### Idea 5 — Launcher

**Why next:** Guide’s minimal `Launcher.up` isn’t a standalone form; only Lookup compound exists.

| Missing | Teach |
|---------|--------|
| `minimal-up.ts` | spawn → Ready → handoff → exit |
| `handle-phases.ts` | spawn / awaitReady / handoff / kill |
| `token-injection.ts` | `Launcher.command` env vs argv |
| `ready-services.ts` | `ready.services` named Tags |
| `ready-timeout.ts` | `ReadyTimedOut` / `ChildExited` by `_tag` |

**Blocked:** none for beta surface (Agent 5 deferred nameless / `Handle.events` stay out).

---

### Idea 6 — Readiness

**Why next:** [`readiness.md`](../services/readiness.md) teachable; zero topic forms.

| Missing | Teach |
|---------|--------|
| `with-readiness.ts` | tag derivation → `/health` / `Node.status` |
| `all-ready.ts` | `readinessOf` + `allReady` |
| `monitored-dependency.ts` | status/changes/readyWhen factory |
| `degraded-health.ts` | force not-ready, 503 shape |

**Folder:** `examples/readiness/` (or nest under `hyperlink/` if owner prefers fewer topics).

---

### Idea 7 — Hyperlink (Tag & wire)

**Why next:** Hub has defaults + Spec wire; no “first Counter” runnable form.

| Missing | Teach |
|---------|--------|
| `counter-layer.ts` | Tag + impl + `Hyperlink.layer` + `yield*` |
| `serve-client.ts` | same Tag over RPC (minimal) |
| `method-kinds.ts` | `effect` / `effectFn` / `ref` / `stream` |

**Guides:** getting-started Hyperlink, hub § Hyperlink.  
**Don’t duplicate:** node matrix already covers addressless/nameless/etc.

---

### Idea 8 — Daemon (beyond Soft store)

**Have:** Soft auto-write, typed Failed; schedule/* + polling/* for `make`/cadence.

| Missing | Teach |
|---------|--------|
| `serve-client.ts` | `Daemon.serve` + `Hyperlink.client` |
| `result-ref.ts` | tag `success` + `result.get` / `changes` |
| `tag-schedule.ts` | `Daemon.schedule` on **layer** Tag |
| `configure.ts` | `Daemon.configure` |

---

### Idea 9 — Fleet edges (small)

**Have:** telemetry / health / shardmap glass.

| Missing | Teach |
|---------|--------|
| `telemetry-alone.ts` | `Telemetry.alone` without peersLayer |
| `shardmap-persist.ts` | `{ filename }` keyed SQL |
| `health-with-readiness.ts` | FleetHealth + readiness rows |

---

### Idea 10 — Apps / View / Dashboard → **stop for topic forms**

Not 1-file topics. See E5 + Agent G. Hub keeps run matrix only.

---

## Thin topics (at a glance)

| Topic | On disk | Gap |
|-------|---------|-----|
| **logs** | — | full guide, zero forms |
| **readiness** | — | full service guide, zero forms |
| **observe** | 1 mock | recipe table + packs |
| **launcher** | 1 compound | no minimal `up` |
| **work-pool** | 2 | most guide recipes |
| **store** | 2 custom | Soft / multi-reg / History |
| **hyperlink** | 2 advanced | first Counter / method kinds |
| **daemon** | 2 Soft | serve / result / Tag.schedule |
| **metrics** | 0 | pointer → Telemetry (don’t fork glass) |
| **bundles / view-data** | 0 | retired — map only |

---

## Do not propose (already covered or wrong medium)

- Gate matrix, Node discovery matrix, Schedule, Polling, Config hot-swap  
- Fleet glass trio as greenfield  
- Hub scenarios (multi-protocol, schedule-sync, serve-per-deps, NWSL)  
- Apps Twoslash dumps; view-scratch; shared harness  
- Bundles / view-data retirement; type-previews demo  
- Redis as a new topic (gate fleet + tests suffice)

---

## Owner call

Owner said **do it all** — Ideas 1–9 Eng’d on tip. Remaining: Idea 10 Apps/E5 ([`examples-apps-e5-plan.md`](./examples-apps-e5-plan.md)).
