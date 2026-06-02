# 16 — Effect RPC transport migration

Migration plan for replacing hand-rolled transport surfaces where Effect already
provides the right abstraction.

## Rule

Use Effect transport modules by default.

- Stateful / streaming / bidirectional protocols → Effect v4 RPC
  (`effect/unstable/rpc` in the current beta line).
- Request-response HTTP compatibility and metadata endpoints →
  `@effect/platform` `HttpApi` / `HttpRouter`.
- Domain services stay transport-agnostic and never know HTTP paths, status
  codes, headers, or RPC framing.

## Current status

`ControlTransportRpc` provides the first Effect RPC transport adapter for the
existing `ControlProtocol` envelope. `LogTransportRpc` provides live relay log
streaming over Effect RPC. Existing HTTP transport remains compatible and is
still the default local/CLI path.

## What should migrate

| Surface | Current shape | Target | Notes |
| --- | --- | --- | --- |
| `ControlTransportHttp` server | hand-rolled `node:http` JSON routes | `@effect/platform` `HttpApi` or `HttpRouter` adapter | Keep `ControlRouter` / `ControlProtocol` transport-neutral. HTTP status mapping belongs only in adapter. |
| Control command transport | `POST /control` envelope over HTTP + implemented `ControlTransportRpc` | Effect RPC adapter for `ControlProtocolRequest` dispatch | Keep HTTP adapter for compatibility; RPC is first-class for new Effect integrations. |
| ProcessManager remote client | HTTP client factory by default + transport injection | injectable transport factories + RPC client adapter | `RemoteProcessManager` remains semantic; `connect(..., { transport })` accepts the RPC adapter. |
| Dashboard control widgets | `fetch` adapter | Effect RPC adapter first; fetch adapter compatibility only | Widgets keep `ControlPlanePort`; adapter owns protocol. |
| Log watch / live streams | HTTP NDJSON stream + implemented `LogTransportRpc` | Effect RPC streaming RPC | Durable log reads stay storage/query APIs; live relay stream transport uses RPC. |
| Remote queue enqueue | not shipped | Effect RPC queue command adapter | Queue item schemas must land first; domain queue service must not know RPC. |
| Remote terminal | planned | Effect RPC streaming RPC | Terminal events use RPC streaming; no custom terminal HTTP routes. |

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

1. **Control RPC adapter** — implemented by `ControlTransportRpc`.
   - Model one dispatch RPC carrying `ControlProtocolRequestEnvelope`.
   - Keep `ControlRouter` unchanged.
   - Keep `ControlTransportHttp` for compatibility.

2. **Control HTTP platform adapter**
   - Rebuild `ControlTransportHttp.server` on `@effect/platform` `HttpApi` /
     `HttpRouter`.
   - Preserve current public HTTP routes for compatibility.
   - Move all status-code mapping into the adapter.

3. **ProcessManager adapter injection polish**
   - Keep `ProcessManager.connect(..., { transport })` as the semantic entry.
   - Consider helper docs/examples for HTTP/RPC runtime construction.
   - Keep typed `RemoteProcessManager` unchanged.

4. **Dashboard adapters**
   - Add `@nikscripts/effect-pm/react/adapters/rpc`.
   - Keep fetch adapter as compatibility/dev path.
   - Widgets continue using `ControlPlanePort`.

5. **Live streams**
   - Live relay logs use `LogTransportRpc`.
   - Move future terminal events to RPC streaming.
   - Keep durable log history in storage/query APIs.

6. **Queue remote enqueue**
   - After queue item schema contracts land, add RPC enqueue/handoff adapters.

## Acceptance checks

- Domain services compile without imports from `@effect/platform`, Effect RPC
  modules, `fetch`, or HTTP route helpers.
- HTTP and RPC adapters can both dispatch the same semantic command.
- `ProcessManager.connect(..., { transport })` can use the RPC adapter without
  typed process/queue API changes.
- React widgets can swap fetch/RPC adapters without prop or hook changes.
- Live logs are represented as Effect streams at the adapter boundary; terminal
  events still need their own future adapter.
- Existing HTTP examples continue to work until deprecated intentionally.

## Version note

Do not install npm `@effect/rpc@0.75.1` with this repo's current
`effect@4.0.0-beta.*` line. That package targets Effect 3 runtime paths. Use the
RPC modules shipped under `effect/unstable/rpc` until a compatible standalone
package line is available.
