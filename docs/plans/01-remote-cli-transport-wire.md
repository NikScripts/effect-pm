# 01 — Remote CLI, transports, control plane wire

Future work layered on **`ControlProtocol`** + **`ControlRouter`**: semantics stay
transport-agnostic; HTTP / RPC / gates are adapters.

## Landed (integration branch — see guides, not this file)

- **`ControlProtocol`**, **`ControlTransportHttp`**, **`makeControlProtocolRouter`**
- **`ProcessManager.connect(..., { transport })`**
- Root and subpath export namespaces for control modules

Shipped wiring: [control-plane.md](../guides/control-plane.md). Operator UX and
extra transports remain below.

## Near-term polish

- Multi-group **`ProcessManager.cli`**: ergonomic output, contract capability hints
  when a command stops before HTTP, examples aligned with **`Transport`** /
  **`ConnectionRegistry`**.
- **`ProcessManager`**: injected **`ControlTransportClient`** factories (stop
  assuming HTTP-only) once multiple wires exist.

## Control surface upgrades

- **Listen config** — configurable bind **`host`** (default loopback); document
  risk profiles for VPC vs dev.
- **Ingress profiles** — optional strict mode so private listeners do not expose
  dangerous REST shortcuts without explicit allow-list.
- **Ingress gate** — `Layer`-mounted authorization (`Context.Tag`) before routing
  to **`ControlRouter`**, plus optional **`@effect/rpc`** **`RpcMiddleware`**
  mirror for the same **`dispatch`** payloads.
- **Platform migration (optional)** — rebuild **`ControlTransportHttp`** atop
  **`@effect/platform` `HttpApp` / `HttpRouter`** for stacks of middleware +
  timeouts.
- **`GET /events`** or SSE streaming of storage-backed lifecycle/process events —
  orthogonal to **`05-log-transport`** (application logs vs store events).

## Remote queue enqueue (defer detail)

Depends on **`03-queue-remote-handoff`**: **`POST`/RPC paths** carrying
schema-valid payloads, mirrored on **`remoteLayer`** **`ProcessGroup`**.
