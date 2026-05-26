# Embedded React widgets & control plane wiring

This package ships the **`ControlService`** HTTP API and **`ProcessGroup` contracts**, not a finished operator product. Intended shape:

| Deliverable | Where | Role |
| --- | --- | --- |
| **Embeddable React components** | Future **`@nikscripts/effect-pm/react`** subpath *(or sibling package — TBD)* | Drop into **your** Next app, SPA, etc. Components take **service-class tags** and a **`fetch`/`baseURL` façade** — see [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md). |
| **Demo app** | `examples/` (e.g. Vite + Tailwind) | Not the product — proves wiring, proxy pattern, Tailscale-ish base URL usage without pulling Next into this repo. |

There is **no** requirement to expose **tRPC** or any app-specific RPC to `effect-pm`. The control plane is **plain HTTP** (`GET /contract`, `POST /processes/:id/start`, …).

---

## Dependencies: `peerDependencies`

When publishing React primitives:

1. Declare **`react` and `react-dom`** (for web) as **`peerDependencies`** with a semver range aligned to your docs (e.g. `>=18`).
2. List **`effect`** alongside **`peerDependencies`** (already expected for **`@nikscripts/effect-pm`** consumers).
3. Put **`typescript`** types-only expectations in **`peerDependencies`** only if needed; normally types ship with **`@types/react`** as devDeps of consumers.

Using **peers** prevents nested duplicate React and avoids locking one React version inside the PM package.

Optional peers: **`@tanstack/react-query`** — if hooks use RQ internally, declare it **optional** and document vanilla `fetch` examples.

---

## API topology — one pattern everywhere

Treat **everything** — **examples**, Tailscale MVP, eventual Next prod — as the **same** shape:

```
Browser ──► same‑origin CONTROL GATEWAY ──► (private HTTP) ──► ControlService
```

- **Widgets never target `ControlService` by URL.** They only **`fetch`** a **`baseUrl`** you choose (typically **`https://dash.example.internal/api/control`** during dev/demo, **`/api/...`** in Next).
- The **gateway** is *whatever* terminates HTTP **before** the PM process — Next route handlers/tRPC adapters, **`express`**, **`fastify`**, **Caddy**, or even **Vite `server.proxy`** in dev (still **`/api/control → http://127.0.0.1:3001`**). Same mental model; only the middleware stack changes.
- **`ControlService` stays private**: bind **`127.0.0.1`** on the runner, listen on a VPC tailnet iface in prod, reachable **only from** gateway hosts / mesh routes.

Because you only develop **widgets + gateway contract + PM runtime**, there is **not** a second “direct browser → PM” product path — at most **unauthenticated forwarding** (`stripPrefix + fetch`) counts as **a gateway with zero policy**, which is deliberate for Tailscale‑only setups until you bolt on auth.

### How this lands **inside `@nikscripts/effect-pm`**

Shipping **topology** does **not** mean embedding **Next** or **tRPC** in the library.

| Responsibility | In `@nikscripts/effect-pm` | In your application |
| --- | --- | --- |
| **`ControlService` HTTP** contract, docs, **`ControlResponse`** | Yes (today) | — |
| Optional thin **`ControlClient`** / URL builders | Yes — possible future subpath (e.g. **`/react`**) | — |
| **React** widgets that call **`fetch(baseUrl, …)`** | Yes — declare **`react`** / **`react-dom`** as **peers** | Compose in pages/layouts |
| **`baseUrl`**, **`credentials`**, CSRF, extra headers | API surface on components / context | You set per environment |
| **Authenticated** `/api/control/*` gateway (**Better Auth**, PAT scopes, audit logs) | **Not** shipped | **Next**, **Express**, **Hono**, etc. |
| **Demo / dev** gateway (forward `stripPrefix` → `127.0.0.1:<port>`) | **`examples/`** reference only (no Next in-tree) | Copy or replace with your server |

`*` If **`@nikscripts/effect-pm/react`** exists, it still only **builds paths** + **decodes responses** — never session tables or route files.

Using **tRPC** for *your mobile ↔ API* remains valid: **tRPC procedures** are just **gateway implementation details** (`ctx` verifies session → **`fetch(processManagerUrl,...)`**) — **`effect-pm` never parses tRPC payloads**.

Widgets should expose hooks for **`credentials: include`**, bearer injection, headers, **`x-correlation-id`**, … only when **`baseUrl` hits your authenticated gateway**.

---

## Security posture (iterate now / enforce later)

1. **`ControlService` binds `127.0.0.1`** and has **no** built-in authentication — unchanged.
2. **Private network MVP** — Tailscale on both Dash + Groups is legitimate **short-term containment** provided ACLs constrain who joins the tailnet.
3. **Production guardrails you should design around now** *(implement when ready)*:
   - **Never** terminate raw **`ControlService`** on `:443`; always **gateway**.
   - **AuthZ** keyed on **logical group/process id**, not merely “authenticated user exists”.
   - **TLS or tailnet‑only RPC** edge-to-edge; **`mTLS` / signed requests** roadmap items already hinted in PACKAGE-GUIDE.
   - **Rate limits**, **mutation allowlists** per role, **`Idempotency-Key`** for POSTs once you automate restarts via UI.

Publishing React peers **today** doesn’t worsen security provided **`baseURL` abstraction** pushes **later** gateways into app code cleanly.

---

## Read these next

| Doc | Why |
| --- | --- |
| [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md) | **Mandatory** split between **tags** (shared with frontend) vs **layers/runtime** (Node only). |
| [control-plane.md](./control-plane.md) | **`ControlService`** REST, **`encodeURIComponent`** ids, **`ControlResponse`**. |
| [process-manager.md](./process-manager.md) | Typed **`ProcessManager.connect`** mentally maps to **`POST /control`** on the HTTP side. |

---

## Single dev checklist

1. **Tags module** (+ **runtime**) — [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md).
2. **Gateway process** (even a **noop-auth** forwarder) so the browser **`baseUrl` never names `127.0.0.1:3001`** directly — Vite **`server.proxy`** or **`tsx examples/.../control-gateway.ts`** both count as **implementations**, not alternate architectures.
3. **Widgets** use a **`baseUrl` that targets the gateway origin** (path prefix like **`/api/control`**, not the raw PM host/port) everywhere.
4. **Later**: swap noop gateway internals for authenticated Next routes/tRPC adapters **without** changing widget URLs.

*(Earlier drafts here listed “shortcut vs cleaner” stacks — everything now maps to steps **1‑4**. If you skim old notes referencing **topology A / B**, treat both names as **the same gateway pattern** described above.)*

---

## Operational notes / footguns

- **`ControlService`** remains **`127.0.0.1`**‑only inside the runner — **every browser build** terminates at a **gateway** reachable over **Tailscale / VPC / forwarded localhost**.
- **CORS** mostly vanishes when the UI is served **same‑origin** with that gateway (**recommended**).
- **Tailscale containment** complements but never replaces intentional **AuthZ** once exposure widens beyond your personal mesh.
- Roadmap **`plans/`** entries may revise transport bells/whistles — **`ControlService` HTTP verbs + paths remain canonical** until an explicit **`v2`** ships.
