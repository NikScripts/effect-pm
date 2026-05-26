# Web dashboard integration

This package ships the **runtime and control plane** — not the UI. Treat a dashboard as **any HTTP client** in your app repo that calls **`ControlService`** on the Node process running the **`ProcessGroup`**.

## Read these first

| Doc | Why |
| --- | --- |
| [control-plane.md](./control-plane.md) | **REST** routes (`/health`, `/status`, `/processes/*`, `/queues/*`, `POST /control`), response shape **`ControlResponse`**, id encoding (`encodeURIComponent`) |
| [process-manager.md](./process-manager.md) | **`ProcessManager`** + CLI mental model (`connect`, typed protocol) |
| [process-manager-endpoints.md](./process-manager-endpoints.md) | **`Endpoint`**, **`Transport`**, **`ProcessGroup`** third-arg config (`baseUrl` / port for remote clients) |

## Operational notes before you scaffold UI

1. **Bind address** — `ControlService` listens on **`127.0.0.1`** today (same process as localhost-only assumption). Browser or phone on another machine **cannot** hit that listener directly; use **same-origin proxying** from your dashboard server, Tailscale subnet routing to a gateway, or any pattern that terminates HTTP where the runtime is reachable — then point your UI config at **that** base URL.
2. **Auth** — the HTTP surface is **not authenticated** inside this package; your gateway (Next.js route handlers, ingress, Tailscale ACLs, etc.) owns session / machine identity.
3. **CORS** — `OPTIONS` handlers exist on routes; expose your UI origin only through your gateway if you terminate cross-origin at the reverse proxy instead of on **`ControlService`**.

Backend roadmap that affects remote control UX (CLI transport wire, queues) lives under [`plans/README.md`](../plans/README.md); it does **not** define shipped HTTP behavior yet.
