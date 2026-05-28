# Embedded React widgets & control plane wiring

This package ships the **`ControlService`** HTTP API and **`ProcessGroup` contracts**, not a finished operator product. Intended shape:

| Deliverable | Where | Role |
| --- | --- | --- |
| **Headless control UI** | **`@nikscripts/effect-pm/react`** (+ **`react/adapters/fetch`**) | **`ControlPlanePort`**, hooks, optional unstyled panels. Transport-agnostic ([§ below](#transport-agnostic-widgets--controlplaneport--adapters)). |
| **Styled ops dashboard** | **`@nikscripts/effect-pm/ops-ui`** (`src/ops-ui/`) | Tailwind + shadcn + tables; imports headless layer. [Plan](./dashboard-ops-ui.md). |
| **Demo app** | `examples/dashboard-demo/` | Vite playground — gateway pattern + styled ops UI. |

There is **no** requirement to expose **tRPC** or any app-specific RPC **from this repo**. The **authoritative** runtime wire for PM control today is **plain HTTP** on **`ControlService`**. Your gateway may re-expose that as **tRPC**, **Effect RPC**, or keep **REST**; widgets depend only on **`ControlPlanePort`**.

Service-class layout for bundlers: [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md).

---

## Dependencies: `peerDependencies`

When publishing React primitives:

1. Declare **`react` and `react-dom`** (for web) as **`peerDependencies`** with a semver range aligned to your docs (e.g. `>=18`).
2. List **`effect`** alongside **`peerDependencies`** (already expected for **`@nikscripts/effect-pm`** consumers).
3. Put **`typescript`** types-only expectations in **`peerDependencies`** only if needed; normally types ship with **`@types/react`** as devDeps of consumers.

Using **peers** prevents nested duplicate React and avoids locking one React version inside the PM package.

Optional peers on **`./react`**: **`@tanstack/react-query`**, **`@tanstack/react-table`** — documented for apps building custom UI. **Styled widgets** use normal dependencies in **`src/ops-ui`** (devDeps in-repo until package split). See [dashboard-styling.md](./dashboard-styling.md), [dashboard-ops-ui.md](./dashboard-ops-ui.md).

---

## API topology — one pattern everywhere

Treat **everything** — **examples**, Tailscale MVP, eventual Next prod — as the **same** shape:

```
Browser ──► same‑origin CONTROL GATEWAY ──► (private HTTP) ──► ControlService
```

- **Widgets never call `ControlService` by raw URL.** They depend on an injected **`ControlPlanePort`** (see below); **implementations** use **`fetch`**, **your tRPC client**, **Effect RPC**, etc.
- The **gateway** is *whatever* terminates HTTP **before** the PM process — Next route handlers/tRPC adapters, **`express`**, **`fastify`**, **Caddy**, or even **Vite `server.proxy`** in dev (still **`/api/control → http://127.0.0.1:3001`**). Same mental model; only the middleware stack changes.
- **`ControlService` stays private**: bind **`127.0.0.1`** on the runner, listen on a VPC tailnet iface in prod, reachable **only from** gateway hosts / mesh routes.

Because you only develop **widgets + gateway contract + PM runtime**, there is **not** a second “direct browser → PM” product path — at most **unauthenticated forwarding** (`stripPrefix + fetch`) counts as **a gateway with zero policy**, which is deliberate for Tailscale‑only setups until you bolt on auth.

### How this lands **inside `@nikscripts/effect-pm`**

Shipping **topology** does **not** mean embedding **Next** or **tRPC** in the library.

| Responsibility | In `@nikscripts/effect-pm` | In your application |
| --- | --- | --- |
| **`ControlService` HTTP** contract, docs, **`ControlResponse`** | Yes (today) | — |
| Optional thin **`ControlClient`** / URL builders | Yes — possible future subpath (e.g. **`/react`**) | — |
| **React** widgets consuming a **`ControlPlanePort`** | Yes — **`react`** / **`react-dom`** as **peers** | Provide port via context |
| **`baseUrl`**, **`credentials`**, CSRF, extra headers | API surface on components / context | You set per environment |
| **Authenticated** `/api/control/*` gateway (**Better Auth**, PAT scopes, audit logs) | **Not** shipped | **Next**, **Express**, **Hono**, etc. |
| **Demo / dev** gateway (forward `stripPrefix` → `127.0.0.1:<port>`) | **`examples/`** reference only (no Next in-tree) | Copy or replace with your server |

`*` If **`@nikscripts/effect-pm/react`** exists, core exports define **`ControlPlanePort`** + context — not session tables, route files, or any one RPC framework.

Using **tRPC** for *your mobile ↔ API* remains valid: **tRPC procedures** implement the **gateway** (`ctx` verifies session → **`fetch(processManagerUrl,...)`**) — **`effect-pm`** ships **optional helpers** that wrap a **minimal client shape**, not **`@trpc/client`** itself (**optional peer** if we ship `createTrpcControlPlaneAdapter`).

Widgets obtain auth headers / **`credentials`** through **adapter constructors** or a tiny **`getRequestInit()`** hook on the **`ControlPlanePort`**, not by hardcoding **`fetch`**.

---

## Transport-agnostic widgets — `ControlPlanePort` + adapters

### Idea

1. Define a **small semantic port** (methods mirror **operator** intent: contract, status, process mutation, queue mutation). Return **`Promise`** (or **`TaskEither`** later) so React + React Query stay simple.
2. **Widgets import only that interface** + **`React.createContext`**.
3. **`createFetchControlPlaneAdapter`**, **`createTrpcControlPlaneAdapter`**, **`createEffectRpcControlPlaneAdapter`** (names TBD) live in **orthogonal entry points** so **`@trpc/client`** / **`@effect/rpc`** stay **optional** dependencies of the **app**, not forced transitive deps.

### Sketch — port (pseudo‑TypeScript)

```typescript
/** Stable application-facing API — not HTTP paths */
export interface ControlPlanePort {
  readonly getContract: () => Promise<ProcessGroupContract<string, readonly unknown[]>>;
  readonly getStatus: () => Promise<unknown>; // tighten to shipped status DTO
  readonly getProcess: (id: string) => Promise<unknown>;
  readonly postProcessAction: (id: string, action: "start" | "stop" | "restart" | "now") => Promise<ControlResponse<unknown>>;
  readonly getQueue: (id: string) => Promise<unknown>;
  readonly postQueueAction: (id: string, action: "start" | "pause" | "resume" | "clear") => Promise<ControlResponse<unknown>>;
}
```

`createFetchAdapter` accepts `defaultInit` / `mergeRequestInit` beside `baseUrl`. **tRPC** and **Effect RPC** factories attach auth headers on **`trpc`/RPC client** construction instead — do not force **`RequestInit`** onto the core interface unless every adapter needs it.

Components: `const port = useContext(ControlPlaneContext); await port.postProcessAction(tag.id, "start")`.

### Adapter: **`fetch`**

Implementation composes **`baseUrl` + `encodeURIComponent`** + **`ControlResponse`** decode — today’s mental model, moved behind the port.

### Adapter: **tRPC** (duck-typed)

Avoid importing **`@trpc/client`** in core widgets. Accept **any object** that matches the port’s **operational** needs, e.g.:

```typescript
export function createTrpcControlPlaneAdapter(pm: {
  contract: { query: () => Promise<ProcessGroupContract<string, readonly unknown[]>> };
  status: { query: () => Promise<unknown> };
  processAction: { mutate: (input: { id: string; action: string }) => Promise<ControlResponse<unknown>> };
  // …mirror your router
}): ControlPlanePort {
  return {
    getContract: () => pm.contract.query(),
    getStatus: () => pm.status.query(),
    postProcessAction: (id, action) => pm.processAction.mutate({ id, action }),
    // ...
  };
}
```

Your **Next router** maps each procedure → **`fetch` to private `ControlService`**. Widgets neither know nor care.

### Adapter: **Effect RPC**

Likely shapes:

| Layer | Responsibility |
| --- | --- |
| **RPC server** (gateway host) | Handlers **`Effect.runFork`** **`fetch`/`ProcessManager`** to **`ControlService`**, optionally centralize **`Layer`** with logging/metrics/auth |
| **RPC client adapter** | `createEffectRpcControlPlaneStub(rpc)` where each port method **`runPromise(effect)`** *(or **`Runtime.runPromise` with shared runtime)* |

**Important:** **`Effect`** must not leak into JSX. **Freeze** **`Effect<A,E,R>` behind `Promise<A>`** inside the adapter (same as SSR bridges today). Optionally expose **advanced hooks** **`useEffectControlPlaneSubscriptions`** later for streams — still optional.

### Optional peer boundaries

| Entry | Depends on |
| --- | --- |
| `@nikscripts/effect-pm/react` | `react`, `effect` typings only |
| `@nikscripts/effect-pm/react/adapters/fetch` | *(none besides global `fetch`)* |
| `@nikscripts/effect-pm/react/adapters/trpc` | **`@trpc/client`** *optional peer* |
| `@nikscripts/effect-pm/react/adapters/effect-rpc` | **`@effect/rpc`** *optional peer* |

Ship **tree-shakeable** modules so a **fetch-only** app never resolves tRPC.

### Contract evolution

If **Effect RPC** definitions become **generated from the same `Schema` as `ControlService`**, you get **one source of truth** for request/response shapes; **HTTP** and **RPC** gateways both implement **`ControlPlanePort`** **without** widget churn.

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
| [dashboard-ops-ui.md](./dashboard-ops-ui.md) | Styled **`src/ops-ui`** plan and WOW import. |
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
