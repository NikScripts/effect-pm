# Examples (`examples/`)

**Find an example:** open the **[Examples hub](../docs/examples.md)** (grouped like the guides),
or go to `examples/<topic>/<name>.ts` and run `pnpm run example:<topic>-<name>`.

Paired docs live at `docs/examples/<topic>/<name>.md` and Twoslash-`include` the same `.ts`
(with `// ---cut---` hiding harness noise). Full demos are under [`apps/`](./apps/).

| Layer | Path | Purpose |
|-------|------|---------|
| **Topics** | `work-pool/`, `gate/`, `daemon/`, `node/`, `fleet/`, `launcher/`, `hyperlink/`, `store/`, `schedule/`, `polling/`, `config/`, `observe/` | One API shape per file — same names as the guides |
| **Scenarios** | [`scenarios/`](./scenarios/) | Multi-file / multi-process compositions |
| **Apps** | [`apps/`](./apps/) | TUI, web, dashboard, CLI, widgets (not 1:1 Twoslash yet) |
| **Shared** | [`shared/`](./shared/) | Harness helpers |

Living book: [docs/index.md](../docs/index.md) · [API Reference](https://hyperlink.cool/api/hyperlink-ts).

---

## Prerequisites

- **Node.js** compatible with the repo `engines` field in `package.json`.
- **Dependencies** installed from the package root (`pnpm install`).
- Most examples use **`tsx`** via `pnpm run example:*`.

---

## Suggested tracks

| Track | Read / run |
|-------|------------|
| **Start here** | [`work-pool/priority-retry.ts`](./work-pool/priority-retry.ts) → [hub § WorkPool](../docs/examples.md) |
| **WorkPool** | `priority-retry` → `named-lanes` |
| **Gate** | `gate/unit-and-input` → `store-readback` → `runtime-observer` → http-client → http-api |
| **Daemon + Soft** | `daemon/store-auto-write` → `typed-failed-error` |
| **Node & discovery** | `node/tag-addressed` → `tag-bound` → `clients` → addressless → nameless unix → `prototype` → `as-lookup` → nameless http/ws → `identity-coordinator` |
| **Fleet glass** | `fleet/telemetry-glass` → `health-glass` → `shardmap-sessions` |
| **Launcher** | `launcher/lookup-membership` |
| **Schedule / polling / config** | `pnpm run example:schedule-basics` → `example:schedule-controls` → `example:polling-sports` → `example:config-hot-swap` |
| **Observe** | `pnpm run example:observe-pack-demo` · guide [Observe](../docs/guides/observe.md) |
| **Scenarios** | `scenarios/multi-protocol-dual-serve` → `schedule-sync-from-db` → `serve-per-deps` → NWSL |
| **Apps** | `pnpm run example:apps-tui` · `example:apps-web` (+ `example:apps-web-server`) · `example:apps-dashboard` · `example:apps-cli` |

---

## Topic catalog

Paths are under `examples/`. Script = `pnpm run example:<topic>-<kebab-file>` (see `package.json`).

### WorkPool — guide [Work pools](../docs/guides/work-pools.md)

| File | Teaches |
|------|---------|
| [`work-pool/priority-retry.ts`](./work-pool/priority-retry.ts) | Priority, dedup key, handler retry |
| [`work-pool/named-lanes.ts`](./work-pool/named-lanes.ts) | Named lanes, weighted take |

### Gate — guide [Gates](../docs/guides/gates.md)

| File | Teaches |
|------|---------|
| [`gate/unit-and-input.ts`](./gate/unit-and-input.ts) | Unit/input forms + concurrency |
| [`gate/store-readback.ts`](./gate/store-readback.ts) | Auto-write + store readback |
| [`gate/runtime-observer.ts`](./gate/runtime-observer.ts) | Observable handle via `Subscribable` |
| [`gate/http-client.ts`](./gate/http-client.ts) | `HttpClientGate.transformClient` |
| [`gate/http-api-client.ts`](./gate/http-api-client.ts) | `Gate.HttpApiClient` Tag |
| [`gate/http-api-layer.ts`](./gate/http-api-layer.ts) | `Gate.httpApiClientLayer` |
| [`gate/rate-limit-fleet.ts`](./gate/rate-limit-fleet.ts) | Rate limit across fleet |

### Daemon — guide [Daemons](../docs/guides/daemons.md)

| File | Teaches |
|------|---------|
| [`daemon/store-auto-write.ts`](./daemon/store-auto-write.ts) | `Daemon.layer` + `Daemon.store` auto-append |
| [`daemon/typed-failed-error.ts`](./daemon/typed-failed-error.ts) | Typed `Failed.error` in history |

### Node — [Identity coordinator](../docs/guides/identity-coordinator.md) · [Fleets and peers](../docs/services/fleets-and-peers.md)

| File | Teaches |
|------|---------|
| [`node/tag-addressed.ts`](./node/tag-addressed.ts) | `Node.Tag` + unix/client |
| [`node/tag-bound.ts`](./node/tag-bound.ts) | Tag carries node |
| [`node/clients.ts`](./node/clients.ts) | `Node.clients` catalog |
| [`node/addressless-serve.ts`](./node/addressless-serve.ts) / [`addressless-call.ts`](./node/addressless-call.ts) | Lookup-piped addressless |
| [`node/nameless-unix-*.ts`](./node/) | Nameless unix serve/call/demo |
| [`node/nameless-http-serve.ts`](./node/nameless-http-serve.ts) / [`nameless-ws-serve.ts`](./node/nameless-ws-serve.ts) | Protocol siblings |
| [`node/prototype.ts`](./node/prototype.ts) | `Node.Prototype.make` |
| [`node/as-lookup.ts`](./node/as-lookup.ts) | `Node.asLookup` |
| [`node/identity-coordinator.ts`](./node/identity-coordinator.ts) | Router + workers + Lookup |
| [`node/verify-connection.ts`](./node/verify-connection.ts) | `Hyperlink.verifyConnection` |

### Fleet

| File | Teaches |
|------|---------|
| [`fleet/telemetry-glass.ts`](./fleet/telemetry-glass.ts) | Telemetry fleet glass |
| [`fleet/health-glass.ts`](./fleet/health-glass.ts) | FleetHealth |
| [`fleet/shardmap-sessions.ts`](./fleet/shardmap-sessions.ts) | ShardMap sessions |

### Launcher · Hyperlink · Store · Schedule · Polling · Config · Observe

| File | Teaches |
|------|---------|
| [`launcher/lookup-membership.ts`](./launcher/lookup-membership.ts) | Launcher → Lookup membership |
| [`hyperlink/tag-defaults.ts`](./hyperlink/tag-defaults.ts) | Tag defaults |
| [`hyperlink/shared-spec-wire.ts`](./hyperlink/shared-spec-wire.ts) | Shared Spec wire |
| [`store/memory.ts`](./store/memory.ts) / [`sqlite.ts`](./store/sqlite.ts) | Store backends |
| [`schedule/*.ts`](./schedule/) | `at` / `window` / `define` / controls |
| [`polling/*.ts`](./polling/) | accelerating / spaced / reset / peek / delayed-start |
| [`config/hot-swap.ts`](./config/hot-swap.ts) | Dynamic config hot swap |
| [`observe/pack-demo.ts`](./observe/pack-demo.ts) | `Observe.bind` + compositional pack |

---

## Scenarios

| File | Docs |
|------|------|
| [`scenarios/multi-protocol-dual-serve.ts`](./scenarios/multi-protocol-dual-serve.ts) | [page](../docs/examples/scenarios/multi-protocol-dual-serve.md) |
| [`scenarios/schedule-sync-from-db.ts`](./scenarios/schedule-sync-from-db.ts) | [page](../docs/examples/scenarios/schedule-sync-from-db.md) |
| [`scenarios/serve-per-deps.ts`](./scenarios/serve-per-deps.ts) | [page](../docs/examples/scenarios/serve-per-deps.md) |
| [`scenarios/nwslsoccer/gate-http-api-client.ts`](./scenarios/nwslsoccer/gate-http-api-client.ts) | [page](../docs/examples/scenarios/gate-http-api-client.md) |

---

## Apps (`examples/apps/`)

Prefer `example:apps-*` scripts. Compat aliases (`example:hyperlink-tui`, …) still resolve but are not cited in docs.

| App | Path | Start |
|-----|------|-------|
| TUI | [`apps/tui/`](./apps/tui/) | `pnpm run example:apps-tui` |
| Web | [`apps/web/`](./apps/web/) | `example:apps-web` + `example:apps-web-server` |
| Dashboard | [`apps/dashboard/`](./apps/dashboard/) | `example:apps-dashboard` |
| CLI | [`apps/cli/`](./apps/cli/) | `example:apps-cli` |
| Queue widget | [`apps/queue-widget/`](./apps/queue-widget/) | `example:apps-queue-widget` |
| View compose | [`apps/view-compose/`](./apps/view-compose/) | `example:apps-view-compose` |

---

## npm scripts (from package root)

Prefer `example:<topic>-<name>` for teaching scripts and `example:apps-*` for apps.
Composites: `example:schedule-basics`, `example:schedule-controls`, `example:polling-sports`,
`example:daemon-patterns`.

```bash
pnpm run example:work-pool-priority-retry
pnpm run example:gate-unit-and-input
npx tsx examples/schedule/at.ts
```

---

## Control port

Examples and the CLI default to port **3001** unless **`HOME_SERVER_PORT`** is set.

---

## For AI assistants

1. `src/*.ts` + TSDoc  
2. Living book + [Examples hub](../docs/examples.md)  
3. `examples/<topic>/` for one API shape; `scenarios/` for composition; `apps/` for product demos  

Committed agent map: [AGENTS.md](../AGENTS.md).
