# Examples IA reorg — replace `forms/` + confusing names

**Status:** **Eng’d** (2026-07-29) — tree + hub + scripts + Twoslash globs; polish pass (Run headers, guide cites, README discovery).  
**Branch:** `cursor/hyperservice-open-deps-5679`.  
**Supersedes naming in:** [`agent-01-examples-book.md`](../../../agent-01-examples-book.md); apps live under `examples/apps/*` (update E5 plan paths when locking).

## Goal

Make examples **findable like the living guides**: same topic names, short file names, one hub
grouped like `docs/nav.ts` Included Services + Guides — not a dump called `forms/hyperlink`.

## New tree

```
examples/
  work-pool/       # WorkPool guide
  gate/            # Gate guide
  daemon/          # Daemon + Soft store ticks
  node/            # Node / Lookup / discovery
  fleet/           # Telemetry, FleetHealth, ShardMap
  launcher/        # Launcher + Lookup membership
  hyperlink/       # Tag defaults, shared Spec wire (core Hyperlink)
  store/           # Store.Service
  schedule/        # Daemon schedule controls
  polling/         # Polling cadences
  config/          # Dynamic config
  observe/         # Observe.bind / packs (guide: observe)
  scenarios/       # multi-file compositions (+ serve-per, NWSL)
  apps/            # tui, web, dashboard, cli, widgets (not 1:1 Twoslash)
  shared/          # harness (unchanged role)
```

**Deleted concept:** `examples/forms/**`. Teaching scripts live in topic folders.

**Docs pairs:** `docs/examples/<topic>/<name>.md` with `include="examples/<topic>/<name>.ts"`.  
**Slugs:** prefer `topic-name` (e.g. `work-pool-priority-retry`) so URLs grep like guides.  
**Scripts:** `example:<topic>-<name>` — drop the `example:form:` prefix.

## Hub sections (mirror nav)

1. WorkPool → guide `/docs/work-pools`  
2. Gate → `/docs/gates`  
3. Daemon → `/docs/daemons`  
4. Node & discovery  
5. Fleet (Telemetry / FleetHealth / ShardMap)  
6. Launcher  
7. Hyperlink (Tag / wire)  
8. Store → `/docs/stores`  
9. Schedule · Polling · Config  
10. Observe → `/docs/observe`  
11. Scenarios  
12. Apps (run matrix only until E5 extracts)

## Rename map (old → new)

Historical: Eng’d on tip; one-shot `scripts/reorg-examples-ia.mjs` removed after land.

## Non-goals

- Sidebar chapter tree for every example (still hub-only)  
- Twoslash every app file (E5 plan unchanged)  
- Broader docs L6 sidebar lock (separate)
