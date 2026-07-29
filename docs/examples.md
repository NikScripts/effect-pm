{#examples title="Examples" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/examples>.
<!-- docs-site-link:end -->
# Examples

Teaching scripts live under `examples/<topic>/` — **same topic names as the guides**.
Each page Twoslash-`include`s the real `.ts` file. Cuts in that file hide harness noise.

Deep-link a topic: `#work-pool`, `#gate`, `#node`, `#observe`, …

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

---

## Node & discovery

Guide: [Node & discovery](/docs/identity-coordinator)

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

---

## Launcher

Guide: [Launcher](/docs/launcher)

### [Lookup membership](/docs/launcher-lookup-membership)

`examples/launcher/lookup-membership.ts` · `pnpm run example:launcher-lookup-membership`

Child of [Lookup membership](/docs/launcher-lookup-membership): `examples/launcher/lookup-membership-child.ts`

---

## Hyperlink (Tag & wire)

Guide: [Hyperlink (Tag & wire)](/docs/creating-a-hyperlink)

### [Tag defaults](/docs/hyperlink-tag-defaults)

`examples/hyperlink/tag-defaults.ts` · `pnpm run example:hyperlink-tag-defaults`

### [shared Spec wire](/docs/hyperlink-shared-spec-wire)

`examples/hyperlink/shared-spec-wire.ts` · `pnpm run example:hyperlink-shared-spec-wire`

---

## Store

Guide: [Store](/docs/stores)

### [memory](/docs/store-memory)

`examples/store/memory.ts` · `pnpm run example:store-memory`

### [SQLite](/docs/store-sqlite)

`examples/store/sqlite.ts` · `pnpm run example:store-sqlite`

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
| Web | `examples/apps/web` | `example:apps-web` + `example:apps-web-server` |
| Dashboard | `examples/apps/dashboard` | `example:apps-dashboard` |
| CLI | `examples/apps/cli` | `example:apps-cli` |
| Queue widget | `examples/apps/queue-widget` | `example:apps-queue-widget` |
| View compose | `examples/apps/view-compose` | `example:apps-view-compose` |
