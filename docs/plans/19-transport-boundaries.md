# 19 — Transport boundaries & unified transport architecture

Future work: **one semantic transport per data domain**, **one shared control
transport for every operator interface**, **protocol adapters only at the edge**
(HTTP, WebSocket, NDJSON, …). No duplicated surfaces.

**Authoritative for:** what belongs in `controlTransport`, `storeTransport`,
`logTransport`, and `telemetryTransport`.

Related: [01-remote-cli-transport-wire.md](./01-remote-cli-transport-wire.md),
[05-log-transport.md](./05-log-transport.md),
[16-effect-rpc-transport-migration.md](./16-effect-rpc-transport-migration.md),
[recipes/store-transport-rpc.md](../recipes/store-transport-rpc.md).

---

## Principles (locked)

### 1. Shared control, separate everything else

**Dashboard, CLI (`ProcessManager`), and any other control UI share one
transport** — the control transport carrying `ControlProtocol` envelopes.

Interface-specific capabilities that are **not** group/process/queue control get
their **own** transport (terminal today; future: file upload, etc.).

### 2. No duplication

Each capability has **exactly one** owning transport. Adapters may expose
multiple wire shapes (REST shortcuts, WebSocket, NDJSON) but they all decode
into the same schema-backed messages for that transport.

**Retire duplicates:**

| Duplicate today | Owner | Action |
| --- | --- | --- |
| `GET /logs/stream` on `ControlTransportHttp` | **log transport** | Remove from control HTTP; clients use log transport |
| Durable log history via HTTP query params | **store transport** (`LogStore`) | Never add log-history routes to control or log transport |
| `GET /events` SSE (plan 01) | **telemetry transport** | Not control REST |
| Facet history reads over ad-hoc HTTP | **store transport** | Registry-direct only |

### 3. Schemas on every transport

Transports are **runtime contracts**. Every request, response, stream item, and
error crosses the wire through **Effect `Schema`** encode/decode — not
TypeScript types alone.

Middleware may transform **encoded** values (same pattern as
`StoreClientMiddleware`).

Domain services (`ControlRouter`, facet resolvers, relay) receive **decoded**
values; adapters never leak raw JSON shapes inward.

### 4. Effect RPC is wire framing, not “the transport”

**HTTP and WebSocket (etc.) are adapters.** The transport module owns:

- message types (`*Message.ts` — same role as `StoreMessage`)
- protocol service tag (`*TransportProtocol`)
- server loop + client (`makeNo*` / `makeClient` — store transport pattern)
- registry- or schema-direct dispatch

Effect RPC internals (`RpcServer.makeNoSerialization`, chunk/ack/interrupt) are
**implementation detail** for NDJSON/WebSocket framing — the same way
`@effect/platform` `HttpRouter` is implementation detail for HTTP adapters.

Do **not** model transports as thin `RpcGroup` wrappers around domain services
(`ControlTransportRpc`, `LogTransportRpc` today). Migrate them to the
**store-transport shape**: protocol tag + message schemas + direct dispatch.

### 5. File naming

| Kind | File / export |
| --- | --- |
| Classes, types, tagged errors | **PascalCase** (`StoreQueryClient`, `ControlProtocolRequestSchema`) |
| Modules, namespaces, factories, layers | **camelCase** — **filename equals main export** |
| Examples | `storeTransport.ts` exports `storeTransport`; `controlTransport.ts` exports `controlTransport`; `controlTransportHttp.ts` is an HTTP **adapter** |

Rename map (future PRs — not blocking boundary decisions):

| Current | Target |
| --- | --- |
| `StoreTransportRpc.ts` | `storeTransport.ts` |
| `ControlTransportRpc.ts` | fold into `controlTransport.ts` |
| `LogTransportRpc.ts` | `logTransport.ts` |
| `ControlTransportHttp.ts` | `controlTransportHttp.ts` |

Subpath exports follow the camelCase module name unless the export is a single
class re-export (document in PACKAGE-GUIDE when renaming ships).

---

## The four transports — what goes where

Decision rule: **follow the source of truth**, not the consumer UI.

```text
                    ┌─────────────────────────────────────┐
  CLI / Dashboard ─►│  controlTransport                   │
  ProcessManager    │  (ControlProtocol)                  │
                    │  mutate + live runtime status       │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
  Dashboard /       │  storeTransport                     │
  analytics / CLI   │  (ProcessStore registry)            │
  read-only tools   │  durable reads (+ stream scans)     │
                    └─────────────── RuntimeStorage ─────┘

                    ┌─────────────────────────────────────┐
  Dashboard /       │  logTransport                       │
  CLI tail          │  (ProcessManagerLogRelay)           │
                    │  live structured log stream         │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
  Dashboard live    │  telemetryTransport                 │
  charts / alerts   │  (facet emit / watch)               │
                    │  live operational events            │
                    └─────────────────────────────────────┘
```

### controlTransport — **operator actions + live runtime snapshot**

**Source:** running `ProcessGroup` / workers (in-memory supervision state).

**Consumers:** CLI, dashboard control widgets, `ProcessManager.connect`, remote
automation — **same client**, inject adapter at the edge.

**Includes:**

- All `ControlProtocolRequest` commands (start/stop/restart process, queue
  pause/resume/clear, …)
- Ephemeral reads that reflect **now**: health, contract, group status, process
  list/status, queue list/status
- Future: remote enqueue / handoff **commands** (plan 03) as new protocol tags —
  still control, not a fifth transport
- Command auth (`CommandAuth`) verifies **control** envelopes only

**Excludes:**

- Durable facet history → **store**
- Live log relay → **log**
- Live facet emit fan-out → **telemetry**
- Terminal I/O → **terminalTransport** (interface-specific)
- Schedule/polling direct API (stays in-process; not remote control v1)

### storeTransport — **durable ProcessStore reads**

**Source:** `RuntimeStorage` via `ProcessStore.registry` dispatch (already
built as `StoreTransportRpc` — rename later).

**Consumers:** dashboard history panels, analytics, export tools, remote
read-only views, `Facet.layerRemote` on PM nodes with storage.

**Includes:**

- Every facet **query** and **forQuery** method: `RunResource.facts`,
  `QueueResource.entries`, `ProcessExecution.executions`, `LogStore.load`,
  lifecycle timelines, …
- **Stream variants** for large scans (`loadStream`, `entriesStream`, …)
- Typed error union (`UnknownFacet`, `PayloadDecodeError`, …)
- Encode/decode in `layerRemote`; client is pure wire

**Excludes:**

- Writes / telemetry emit (in-process `yield* Facet.Event.*` only)
- Live relay logs (not in storage yet, or not read from storage)
- Push notifications on new rows → **telemetry** (optional tail may share storage
  cursor but different subscription semantics)

### logTransport — **live application log stream**

**Source:** `ProcessManagerLogRelay` (capture → pubsub → relay). Structured
`ProcessManagerLogEntry` values.

**Consumers:** dashboard log panel (live tail), CLI follow mode, any subscriber
that wants **semantic logs as they happen**.

**Includes:**

- One primary stream: scoped prelude + optional follow (`LogStreamRequest`
  schema)
- Scope filters: all / group / process / queue (`LogStreamScope` schema)
- Stream items: `ProcessManagerLogEntrySchema`

**Excludes:**

- Durable history / search / cursor replay → **store** (`LogStore.load`,
  `loadStream`)
- HTTP query-param encoding (adapter concern only)
- Control commands

**Composition pattern for UIs:** `logTransport` (live) + `storeTransport`
(backfill on reconnect) — two connections, no overlap.

### telemetryTransport — **live operational facet events**

**Source:** facet **telemetry emit pipeline** (events defined under
`ProcessStore.telemetry(...)`), optionally correlated with storage row ids after
persist.

**Consumers:** dashboard live metrics, queue depth widgets, “something enqueued”
alerts, plan 04 live hooks — **push**, not poll.

**Includes:**

- Subscriptions scoped like logs: group / process / queue / facet / wire type
- Event payloads defined by **facet telemetry schemas** (same schemas used for
  emit + storage codec — single definition)
- Stream of decoded telemetry events (+ schema evolution via middleware)

**Excludes:**

- Historical analytics, aggregations, “give me last 10k entries” → **store**
- Application log text → **log**
- Control mutations → **control**

**Not the same as store tail:** telemetry transport hooks **emit time** (may
include events before persist completes, or fan-out from relay). Store transport
reads **committed rows**. UIs may subscribe to both; transports stay separate.

---

## Fifth transport (interface-specific)

### terminalTransport

**Source:** `Terminal` session service (bidirectional stdin/stdout/events).

**Why separate:** not shared by CLI dashboard controls; unique session lifecycle,
resize, binary chunks. Same adapter pattern (protocol tag + messages + HTTP/WS
adapter).

---

## Adapter layer (not transports)

| Adapter | Carries |
| --- | --- |
| `controlTransportHttp` | Control envelopes + optional REST shortcut decode → envelope |
| `controlTransportWebSocket` | Same messages as NDJSON/WebSocket |
| `storeTransportWebSocket` | `StoreMessage` framing |
| `logTransportWebSocket` | Log stream messages |
| `telemetryTransportWebSocket` | Telemetry stream messages |

All adapters:

1. Parse bytes → encoded message schema
2. Decode → hand to transport server loop
3. Encode response → bytes

---

## Migration from current code

| Module today | Target role |
| --- | --- |
| `ControlProtocol` + `ControlRouter` | Semantic core of **controlTransport** (keep) |
| `ControlTransportHttp` | **Adapter** — shrink to control messages only; drop `/logs/stream` |
| `ControlTransportRpc` | Replace with **controlTransport** server/client loop; WS/HTTP adapter |
| `LogTransportRpc` | Replace with **logTransport** (same schemas, store-transport shape) |
| `StoreTransportRpc` | Rename to **storeTransport**; reference implementation |
| (none) | **telemetryTransport** — new; subscribes at emit hook |

Update [16-effect-rpc-transport-migration.md](./16-effect-rpc-transport-migration.md):
Effect RPC is **framing**, not a separate product surface per domain.

---

## Acceptance checks

- [ ] CLI and dashboard use the same `controlTransport` client type; only
  adapter layers differ.
- [ ] No log history route on control HTTP.
- [ ] Durable logs only via `LogStore` over store transport.
- [ ] Every transport documents its `*Message` schemas and exports encode/decode.
- [ ] No domain service imports HTTP paths or RpcGroup definitions.
- [ ] File renames follow camelCase module = filename rule.

---

## Open questions (owner sign-off)

1. **Telemetry before persist** — emit transport events optimistically, or only
   after `RuntimeStorage.create` succeeds?
2. **Store tail vs telemetry** — if both can push new rows, is telemetry strictly
   emit-tree events and store tail strictly `RuntimeRecord` watches?
3. **Control + store on one WebSocket** — multiplex messages (shared connection)
   vs one socket per transport (simpler routing)? Wire format is per-transport
   either way.
