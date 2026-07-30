{#examples title="Examples" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/examples>.
<!-- docs-site-link:end -->
# Examples

**This page is the examples index** — every teaching form, grouped like the guides.

Teaching scripts live under `examples/<topic>/`. Each form page Twoslash-`include`s the
real `.ts` file (cuts hide harness noise) and carries a **Related examples** note with
cross-links (often several) into neighboring forms and topics.

Deep-link a topic: `#work-pool`, `#gate`, `#node`, `#observe`, `#logs`, `#store`, …

---

## WorkPool

Guide: [WorkPool](/docs/work-pools)

### [priority, dedup, retry](/docs/work-pool-priority-retry)

`examples/work-pool/priority-retry.ts` · `pnpm run example:work-pool-priority-retry`

### [named lanes](/docs/work-pool-named-lanes)

`examples/work-pool/named-lanes.ts` · `pnpm run example:work-pool-named-lanes`

### [store analytics](/docs/work-pool-store-analytics)

`examples/work-pool/store-analytics.ts` · `pnpm run example:work-pool-store-analytics`

### [serve and client](/docs/work-pool-serve-client)

`examples/work-pool/serve-client.ts` · `pnpm run example:work-pool-serve-client`

### [durable SQLite](/docs/work-pool-durable-sqlite)

`examples/work-pool/durable-sqlite.ts` · `pnpm run example:work-pool-durable-sqlite`

### [refill](/docs/work-pool-refill)

`examples/work-pool/refill.ts` · `pnpm run example:work-pool-refill`

### [rate limit](/docs/work-pool-rate-limit)

`examples/work-pool/rate-limit.ts` · `pnpm run example:work-pool-rate-limit`

### [history metrics](/docs/work-pool-history-metrics)

`examples/work-pool/history-metrics.ts` · `pnpm run example:work-pool-history-metrics`

### [typed success](/docs/work-pool-typed-success)

`examples/work-pool/typed-success.ts` · `pnpm run example:work-pool-typed-success`

### [configure](/docs/work-pool-configure)

`examples/work-pool/configure.ts` · `pnpm run example:work-pool-configure`

---

## Gate

Guide: [Gate](/docs/gates)

### [unit + input](/docs/gate-unit-and-input)

`examples/gate/unit-and-input.ts` · `pnpm run example:gate-unit-and-input`

### [fleet rate limit](/docs/gate-rate-limit-fleet)

`examples/gate/rate-limit-fleet.ts` · `pnpm run example:gate-rate-limit-fleet`

### [store readback](/docs/gate-store-readback)

`examples/gate/store-readback.ts` · `pnpm run example:gate-store-readback`

### [runtime observer](/docs/gate-runtime-observer)

`examples/gate/runtime-observer.ts` · `pnpm run example:gate-runtime-observer`

### [HttpClientGate](/docs/gate-http-client)

`examples/gate/http-client.ts` · `pnpm run example:gate-http-client`

### [HttpApiClient](/docs/gate-http-api-client)

`examples/gate/http-api-client.ts` · `pnpm run example:gate-http-api-client`

### [httpApiClientLayer + capture](/docs/gate-http-api-layer)

`examples/gate/http-api-layer.ts` · `pnpm run example:gate-http-api-layer`

---

## Daemon

Guide: [Daemon](/docs/daemons)

### [Soft store auto-write](/docs/daemon-store-auto-write)

`examples/daemon/store-auto-write.ts` · `pnpm run example:daemon-store-auto-write`

### [typed Failed.error](/docs/daemon-typed-failed-error)

`examples/daemon/typed-failed-error.ts` · `pnpm run example:daemon-typed-failed-error`

### [serve and client](/docs/daemon-serve-client)

`examples/daemon/serve-client.ts` · `pnpm run example:daemon-serve-client`

### [result ref](/docs/daemon-result-ref)

`examples/daemon/result-ref.ts` · `pnpm run example:daemon-result-ref`

### [tag schedule](/docs/daemon-tag-schedule)

`examples/daemon/tag-schedule.ts` · `pnpm run example:daemon-tag-schedule`

### [configure](/docs/daemon-configure)

`examples/daemon/configure.ts` · `pnpm run example:daemon-configure`

---

## Node & discovery

Guides: [Identity coordinator](/docs/identity-coordinator) · [Policy](/docs/policy) · [Client verify](/docs/client-verify)

### [Tag with address](/docs/node-tag-addressed)

`examples/node/tag-addressed.ts` · `pnpm run example:node-tag-addressed`

### [Tag-bound serve](/docs/node-tag-bound)

`examples/node/tag-bound.ts` · `pnpm run example:node-tag-bound`

### [clients catalog](/docs/node-clients)

`examples/node/clients.ts` · `pnpm run example:node-clients`

### [addressless serve](/docs/node-addressless-serve)

`examples/node/addressless-serve.ts` · `pnpm run example:node-addressless-serve`

### [addressless call](/docs/node-addressless-call)

`examples/node/addressless-call.ts` · `pnpm run example:node-addressless-call`

### [nameless unix serve](/docs/node-nameless-unix-serve)

`examples/node/nameless-unix-serve.ts` · `pnpm run example:node-nameless-unix-serve`

### [nameless unix call](/docs/node-nameless-unix-call)

`examples/node/nameless-unix-call.ts` · `pnpm run example:node-nameless-unix-call`

### [nameless unix demo](/docs/node-nameless-unix-demo)

`examples/node/nameless-unix-demo.ts` · `pnpm run example:node-nameless-unix-demo`

### [nameless HTTP serve](/docs/node-nameless-http-serve)

`examples/node/nameless-http-serve.ts` · `pnpm run example:node-nameless-http-serve`

### [nameless WebSocket serve](/docs/node-nameless-ws-serve)

`examples/node/nameless-ws-serve.ts` · `pnpm run example:node-nameless-ws-serve`

### [Prototype](/docs/node-prototype)

`examples/node/prototype.ts` · `pnpm run example:node-prototype`

### [asLookup](/docs/node-as-lookup)

`examples/node/as-lookup.ts` · `pnpm run example:node-as-lookup`

### [identity coordinator](/docs/node-identity-coordinator)

`examples/node/identity-coordinator.ts` · `pnpm run example:node-identity-coordinator`

### [A→B handoff cutover](/docs/node-handoff-ab-cutover)

`examples/node/handoff-ab-cutover.ts` · `pnpm run example:node-handoff-ab-cutover`

### [Policy lookup cutover](/docs/node-policy-lookup-cutover)

`examples/node/policy-lookup-cutover.ts` · `pnpm run example:node-policy-lookup-cutover`  
Guide: [Policy](/docs/policy)

### [A→B handoff live (Ink TUI)](/docs/apps-tui-handoff-ab-live)

`examples/apps/tui/handoff-ab-live.tsx` · `pnpm run example:handoff-ab-live` — dual-pane watchable cutover (real TTY)

### [verifyConnection](/docs/node-verify-connection)

`examples/node/verify-connection.ts` · `pnpm run example:node-verify-connection`

---

## Fleet

Guide: [Fleet](/docs/telemetry)

### [Telemetry glass](/docs/fleet-telemetry-glass)

`examples/fleet/telemetry-glass.ts` · `pnpm run example:fleet-telemetry-glass`

### [FleetHealth glass](/docs/fleet-health-glass)

`examples/fleet/health-glass.ts` · `pnpm run example:fleet-health-glass`

### [ShardMap sessions](/docs/fleet-shardmap-sessions)

`examples/fleet/shardmap-sessions.ts` · `pnpm run example:fleet-shardmap-sessions`

### [Telemetry alone](/docs/fleet-telemetry-alone)

`examples/fleet/telemetry-alone.ts` · `pnpm run example:fleet-telemetry-alone`

### [ShardMap persist](/docs/fleet-shardmap-persist)

`examples/fleet/shardmap-persist.ts` · `pnpm run example:fleet-shardmap-persist`

### [health with readiness](/docs/fleet-health-with-readiness)

`examples/fleet/health-with-readiness.ts` · `pnpm run example:fleet-health-with-readiness`

---

## Launcher

Guide: [Launcher](/docs/launcher)

### [Lookup membership](/docs/launcher-lookup-membership)

`examples/launcher/lookup-membership.ts` · `pnpm run example:launcher-lookup-membership`

Child of [Lookup membership](/docs/launcher-lookup-membership): `examples/launcher/lookup-membership-child.ts`

### [minimal up](/docs/launcher-minimal-up)

`examples/launcher/minimal-up.ts` · `pnpm run example:launcher-minimal-up`

### [handle phases](/docs/launcher-handle-phases)

`examples/launcher/handle-phases.ts` · `pnpm run example:launcher-handle-phases`

### [token injection](/docs/launcher-token-injection)

`examples/launcher/token-injection.ts` · `pnpm run example:launcher-token-injection`

### [ready services](/docs/launcher-ready-services)

`examples/launcher/ready-services.ts` · `pnpm run example:launcher-ready-services`

### [Ready timeout errors](/docs/launcher-ready-timeout)

`examples/launcher/ready-timeout.ts` · `pnpm run example:launcher-ready-timeout`

Child helper for Launcher examples: [`examples/launcher/ready-worker-child.ts`](/docs/launcher-ready-worker-child) · `pnpm run example:launcher-ready-worker-child`

---

## Readiness

Guide: [Readiness & Health](/docs/readiness)

### [withReadiness](/docs/readiness-with-readiness)

`examples/readiness/with-readiness.ts` · `pnpm run example:readiness-with-readiness`

### [allReady](/docs/readiness-all-ready)

`examples/readiness/all-ready.ts` · `pnpm run example:readiness-all-ready`

### [monitored dependency](/docs/readiness-monitored-dependency)

`examples/readiness/monitored-dependency.ts` · `pnpm run example:readiness-monitored-dependency`

### [degraded health](/docs/readiness-degraded-health)

`examples/readiness/degraded-health.ts` · `pnpm run example:readiness-degraded-health`

---

## Hyperlink (Tag & wire)

Guide: [Hyperlink (Tag & wire)](/docs/creating-a-hyperlink)

### [Tag defaults](/docs/hyperlink-tag-defaults)

`examples/hyperlink/tag-defaults.ts` · `pnpm run example:hyperlink-tag-defaults`

### [shared Spec wire](/docs/hyperlink-shared-spec-wire)

`examples/hyperlink/shared-spec-wire.ts` · `pnpm run example:hyperlink-shared-spec-wire`

### [counter layer](/docs/hyperlink-counter-layer)

`examples/hyperlink/counter-layer.ts` · `pnpm run example:hyperlink-counter-layer`

### [serve and client](/docs/hyperlink-serve-client)

`examples/hyperlink/serve-client.ts` · `pnpm run example:hyperlink-serve-client`

### [method kinds](/docs/hyperlink-method-kinds)

`examples/hyperlink/method-kinds.ts` · `pnpm run example:hyperlink-method-kinds`

---

## Logs

Guide: [Logs](/docs/logs)

### [live bus](/docs/logs-live-bus)

`examples/logs/live-bus.ts` · `pnpm run example:logs-live-bus`

### [node journal](/docs/logs-node-journal)

`examples/logs/node-journal.ts` · `pnpm run example:logs-node-journal`

### [Hyperlink logs export](/docs/logs-hyperlink-logs)

`examples/logs/hyperlink-logs.ts` · `pnpm run example:logs-hyperlink-logs`

### [lineage scope](/docs/logs-lineage-scope)

`examples/logs/lineage-scope.ts` · `pnpm run example:logs-lineage-scope`

### [levels](/docs/logs-levels)

`examples/logs/levels.ts` · `pnpm run example:logs-levels`

---

## Store

Guide: [Store](/docs/stores)

### [memory](/docs/store-memory)

`examples/store/memory.ts` · `pnpm run example:store-memory`

### [SQLite](/docs/store-sqlite)

`examples/store/sqlite.ts` · `pnpm run example:store-sqlite`

### [Soft override WorkPool](/docs/store-soft-override-work-pool)

`examples/store/soft-override-work-pool.ts` · `pnpm run example:store-soft-override-work-pool`

### [one store, many registrations](/docs/store-one-store-many-regs)

`examples/store/one-store-many-regs.ts` · `pnpm run example:store-one-store-many-regs`

### [durable and Soft planes](/docs/store-durable-and-soft)

`examples/store/durable-and-soft.ts` · `pnpm run example:store-durable-and-soft`

### [HistoryStore presence](/docs/store-history-presence)

`examples/store/history-presence.ts` · `pnpm run example:store-history-presence`

### [loud missing registration](/docs/store-loud-missing-registration)

`examples/store/loud-missing-registration.ts` · `pnpm run example:store-loud-missing-registration`

---

## Schedule

Guide: [Schedule](/docs/daemons)

### [at](/docs/schedule-at)

`examples/schedule/at.ts` · `pnpm run example:schedule-at`

### [window](/docs/schedule-window)

`examples/schedule/window.ts` · `pnpm run example:schedule-window`

### [define](/docs/schedule-define)

`examples/schedule/define.ts` · `pnpm run example:schedule-define`

### [controls (initializer)](/docs/schedule-controls-initializer)

`examples/schedule/controls-initializer.ts` · `pnpm run example:schedule-controls-initializer`

### [controls (in Effect)](/docs/schedule-controls-in-effect)

`examples/schedule/controls-in-effect.ts` · `pnpm run example:schedule-controls-in-effect`

### [controls (external fiber)](/docs/schedule-controls-external-fiber)

`examples/schedule/controls-external-fiber.ts` · `pnpm run example:schedule-controls-external-fiber`

---

## Polling

Guide: [Polling](/docs/daemons)

### [accelerating](/docs/polling-accelerating)

`examples/polling/accelerating.ts` · `pnpm run example:polling-accelerating`

### [spaced](/docs/polling-spaced)

`examples/polling/spaced.ts` · `pnpm run example:polling-spaced`

### [accelerating reset](/docs/polling-accelerating-reset)

`examples/polling/accelerating-reset.ts` · `pnpm run example:polling-accelerating-reset`

### [accelerating peek](/docs/polling-accelerating-peek)

`examples/polling/accelerating-peek.ts` · `pnpm run example:polling-accelerating-peek`

### [delayed start](/docs/polling-delayed-start)

`examples/polling/delayed-start.ts` · `pnpm run example:polling-delayed-start`

---

## Config

Guide: [Config](/docs/configuration)

### [hot swap](/docs/config-hot-swap)

`examples/config/hot-swap.ts` · `pnpm run example:config-hot-swap`

---

## Observe

Guide: [Observe recipes](/docs/observe)

### [pack demo](/docs/observe-pack-demo)

`examples/observe/pack-demo.ts` · `pnpm run example:observe-pack-demo`

`Observe.bind` + compositional pack (same stack as `Observe.use` in React). Not Twoslash-paired yet (top-level await demo).

### [WorkPool pack](/docs/observe-work-pool-pack)

`examples/observe/work-pool-pack.ts` · `pnpm run example:observe-work-pool-pack`

### [recipes](/docs/observe-recipes)

`examples/observe/recipes.ts` · `pnpm run example:observe-recipes`

### [scan and fold](/docs/observe-scan-fold)

`examples/observe/scan-fold.ts` · `pnpm run example:observe-scan-fold`

### [Hyperlink atom adapters](/docs/observe-hyperlink-atom)

`examples/observe/hyperlink-atom.ts` · `pnpm run example:observe-hyperlink-atom`

### [Daemon pack](/docs/observe-daemon-pack)

`examples/observe/daemon-pack.ts` · `pnpm run example:observe-daemon-pack`

### [Gate pack](/docs/observe-gate-pack)

`examples/observe/gate-pack.ts` · `pnpm run example:observe-gate-pack`

---

## UI

Guide / handoff: Route + Router (`docs/handoffs/ui-routes-dream.md`)

### [Router mini-docs](/docs/ui-router-mini-docs)

`examples/ui/router-mini-docs.ts` · `pnpm run example:ui-router-mini-docs`  
Browser: `pnpm run example:apps-router-docs` → <http://localhost:5189>

---

## Scenarios

### [multi-protocol dual serve](/docs/scenario-multi-protocol)

`examples/scenarios/multi-protocol-dual-serve.ts` · `pnpm run example:scenario-multi-protocol`

### [schedule sync from DB](/docs/scenario-schedule-sync-db)

`examples/scenarios/schedule-sync-from-db.ts` · `pnpm run example:scenario-schedule-sync-db`

### [serve-per-deps](/docs/scenario-serve-per-deps)

`examples/scenarios/serve-per-deps.ts` · `pnpm run example:scenario-serve-per-deps`

### [NWSL Gate.HttpApiClient](/docs/scenario-nwsl-http-api)

`examples/scenarios/nwslsoccer/gate-http-api-client.ts` · `pnpm run example:scenario-nwsl-http-api`

---

## Apps

Full apps under `examples/apps/` (TUI, web, dashboard, CLI, widgets). **Not** 1:1 Twoslash —
see [E5 apps plan](../handoffs/examples-apps-e5-plan.md) (handoff). Run via `pnpm run example:apps-tui`,
`example:apps-web`, `example:apps-dashboard`, …

| App | Path | Start |
|-----|------|-------|
| TUI | `examples/apps/tui` | `pnpm run example:apps-tui` |
| A→B handoff live | `examples/apps/tui/handoff-ab-live.tsx` | `pnpm run example:handoff-ab-live` |
| Web | `examples/apps/web` | `example:apps-web` + `example:apps-web-server` |
| Dashboard | `examples/apps/dashboard` | `example:apps-dashboard` |
| CLI | `examples/apps/cli` | `example:apps-cli` |
| Queue widget | `examples/apps/queue-widget` | `example:apps-queue-widget` |
| View compose | `examples/apps/view-compose` | `example:apps-view-compose` |
| Router mini-docs | `examples/apps/router-docs` | `example:apps-router-docs` (+ `example:ui-router-mini-docs`) |
