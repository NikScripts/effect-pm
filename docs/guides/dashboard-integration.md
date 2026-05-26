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

## API topology — who calls whom?

Treat widget HTTP access as **`ControlClient`** (any implementation: `fetch`, ky, openapi‑generated stubs). **`baseUrl`** is injected — **never** hardcode **`127.0.0.1`** inside published components unless explicitly for **local demos**.

### A — Direct to PM (fine for demos + closed networks)

```
Browser ──► reverse proxy ──► ControlService (same Tailscale/host as widgets)
```

- Example: single home server — **Vite dev proxy** forwards `/api/pm → http://127.0.0.1:3001`.
- Tailscale substitutes for auth **only operationally**, not architecturally — you still inherit **`ControlService`’s no-auth contract**.

### B — Via your backend (required for prod Next apps)

```
Browser ──► same-origin Next (tRPC/RSC/session) ──► server-only fetch ──► ControlService / droplet VM
```

- **`tRPC` stays entirely in Next**: procedures call **`fetch(internalPmUrl`** or **`ProcessManager`**-style typed client running **server-side**.
- **`ControlService` stays off the public Internet** — reachable only via **VPC interface**, **Tailscale subnet**, **`127.0.0.1` from** the gateway container, etc.
- No need to replicate tRPC protocols **inside** `effect-pm`; expose **thin route handlers** that forward and attach **Better Auth**, **PATs**, **signed payloads**, **`x-request-id`** for audit logs, etc., when ready.

Widgets should accept **`getAccessToken`** / **`credentials: "include"`** only at the **boundary you own** — i.e., when **`baseUrl` points at your `/api/` Next routes**, **not** at raw **`ControlService`**.

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

## Urgent‑path cheat sheet vs package‑shape path

| Need | Shortcut | Cleaner later |
| --- | --- | --- |
| Working UI this week | Vite **`examples/*/demo-ui`**, same-origin **`fetch`/`proxy`** to **`ControlService`**, widgets colocated *(not necessarily published)* | Extract stable **`effect-pm/react`** + peers + semver |
| Next integration | Duplicate thin **`route.ts`** wrappers that **`fetch`** private PM URL *(session-checked)* | Centralize **`createPmProcedure`** wrapper for tRPC v10 |
| Identify strings | Import **tags-only** TS module next to **`ProdGroup`** | Same — never fork string ids |

---

## Operational notes / footguns

- **Bind address** — `ControlService` is **`127.0.0.1`**‑only **inside** Node; Tailscale/external browser needs **gateway or proxy**.
- **CORS** — easier when browser talks **same-origin** to YOUR backend (topology **B**) than **`ControlService` directly**.
- Roadmap‑only **`plans/`** docs may mention transport upgrades — **`ControlService`** **HTTP contract stays canonical** unless versioned later.
