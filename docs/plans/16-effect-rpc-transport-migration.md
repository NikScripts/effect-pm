# 16 — Effect RPC transport migration

Future migration plan for removing hand-rolled transport surfaces where Effect
already provides the right abstraction.

## Rule

Use Effect transport modules by default.

- Stateful / streaming / bidirectional protocols → `@effect/rpc`.
- Request-response HTTP compatibility and metadata endpoints →
  `@effect/platform` `HttpApi` / `HttpRouter`.
- Domain services stay transport-agnostic and never know HTTP paths, status
  codes, headers, or RPC framing.

## What should migrate

| Surface | Current shape | Target | Notes |
| --- | --- | --- | --- |
| `ControlTransportHttp` server | hand-rolled `node:http` JSON routes | `@effect/platform` `HttpApi` or `HttpRouter` adapter | Keep `ControlRouter` / `ControlProtocol` transport-neutral. HTTP status mapping belongs only in adapter. |
| Control command transport | `POST /control` envelope over HTTP | `@effect/rpc` adapter for `ControlProtocolRequest` dispatch | Keep HTTP adapter for compatibility; RPC should be first-class for new surfaces. |
| ProcessManager remote client | HTTP client factory by default | injectable transport factories + RPC client adapter | `RemoteProcessManager` remains semantic; transport selected at edge. |
| Dashboard control widgets | `fetch` adapter | Effect RPC adapter first; fetch adapter compatibility only | Widgets keep `ControlPlanePort`; adapter owns protocol. |
| Log watch / live streams | HTTP NDJSON stream | `@effect/rpc` streaming RPC | Durable log reads stay storage/query APIs; live stream transport becomes RPC. |
| Remote queue enqueue | not shipped | `@effect/rpc` queue command adapter | Queue item schemas must land first; domain queue service must not know RPC. |
| Remote terminal | planned | `@effect/rpc` streaming RPC | Terminal events use RPC streaming; no custom terminal HTTP routes. |

## What should not migrate

| Surface | Reason |
| --- | --- |
| `RuntimeStorage` / store facets | Storage is a domain/runtime abstraction, not a network protocol. |
| `Process`, `QueueResource`, `ProcessGroup` domain methods | These remain semantic services. Adapters translate HTTP/RPC into these methods. |
| React widget ports | Ports remain transport-agnostic (`ControlPlanePort`, `TerminalSessionPort`). |

## Service boundary invariant

Services must not know transport details.

Allowed in services:

- domain request/response types,
- Effect errors,
- streams,
- Context services,
- storage facets,
- `CommandAuth` verifier/signer services when the service is explicitly
  authentication/transport infrastructure.

Not allowed in domain services:

- HTTP status codes,
- URL paths,
- headers,
- raw `fetch`,
- RPC client/server framing,
- WebSocket/SSE details.

## Suggested migration order

1. **Control HTTP platform adapter**
   - Rebuild `ControlTransportHttp.server` on `@effect/platform` `HttpApi` /
     `HttpRouter`.
   - Preserve current public HTTP routes for compatibility.
   - Move all status-code mapping into the adapter.

2. **Control RPC adapter**
   - Add `ControlTransportRpc` using `@effect/rpc`.
   - Model a single dispatch RPC carrying `ControlProtocolRequestEnvelope`, or
     one RPC per command after the command set stabilizes.
   - Keep `ControlRouter` unchanged.

3. **ProcessManager adapter injection**
   - Stop assuming HTTP in convenience paths.
   - Let `ProcessManager.connect` accept adapter factories for HTTP/RPC.
   - Keep typed `RemoteProcessManager` unchanged.

4. **Dashboard adapters**
   - Add `@nikscripts/effect-pm/react/adapters/rpc`.
   - Keep fetch adapter as compatibility/dev path.
   - Widgets continue using `ControlPlanePort`.

5. **Live streams**
   - Move log watch and future terminal events to RPC streaming.
   - Keep durable log history in storage/query APIs.

6. **Queue remote enqueue**
   - After queue item schema contracts land, add RPC enqueue/handoff adapters.

## Acceptance checks

- Domain services compile without imports from `@effect/platform`,
  `@effect/rpc`, `fetch`, or HTTP route helpers.
- HTTP and RPC adapters can both dispatch the same semantic command.
- React widgets can swap fetch/RPC adapters without prop or hook changes.
- Live logs / terminal events are represented as Effect streams at the adapter
  boundary.
- Existing HTTP examples continue to work until deprecated intentionally.
