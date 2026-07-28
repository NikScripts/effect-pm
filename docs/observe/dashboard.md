{#dashboard title="Dashboard" status="draft" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/dashboard>.
<!-- docs-site-link:end -->
# Dashboard

The web dashboard renders a live view over your HyperServices — a drill-down of WorkPool / Daemon /
Gate / group cards, each with stats, charts, controls, and streaming logs. You point it at a
reactive runtime and a root `Group`:

``` tsx
import { Dashboard } from "hyperlink-ts/web"
import { Atom } from "effect/unstable/reactivity"

const runtime = Atom.runtime(appLayer) // appLayer: your service clients over a transport
<Dashboard runtime={runtime} group={ServicesHub} />
```

## Transport: use a WebSocket in the browser

This is the one setup decision you must get right, and the default is **not** what a browser
wants.

A HyperService client reaches its node over an RPC **transport**. The library ships two:

- **`Hyperlink.http(node, { url })`** — HTTP. The default, and correct for a **server, CLI,
  or backend-to-backend** caller, or any client that opens only a handful of streams.
- **`Hyperlink.ws(node, { url })`** — a single **WebSocket**. Use this for a **browser
  dashboard**.

### Why the browser needs the WebSocket

The dashboard is stream-heavy: every visible HyperService holds **several** live streams open at once
— its `status`, its `metrics`, its `logs` — and the grid shows many services. That is easily
15–20 concurrent streams.

Over the HTTP transport, **each stream is its own browser connection**, and a browser allows only
**~6 connections per origin on HTTP/1.1**. Past that, the extra streams are *starved* — they never
even get a response. The visible symptom is a dashboard that half-works: some cards update, others
sit frozen, **no charts, no logs** — with no error, because the requests are simply queued forever.

A **WebSocket multiplexes every stream for a node over one connection**, so the 6-connection cap
never applies. `ws` is the browser-shaped transport; `http` is not.

{.note}
HTTP/2 (a TLS production server) multiplexes too, so the cap is an HTTP/1.1 phenomenon — but your
dev server (Vite) is HTTP/1.1, and any plain-HTTP deployment is as well. The WebSocket is correct
across all of them, so prefer it for the browser unconditionally.

### Setup

Three matching pieces — the server must serve the same protocol the client speaks:

**1. Server** — serve WebSocket with `Node.wsServer` (the `Node.httpServer` sibling; same
serve list and options, it just speaks WebSocket):

``` ts
Node.wsServer(
  [Hyperlink.serve(Jobs, jobsImpl) /* … */],
)
```

**2. Client** — one `ws` per node. A same-origin **path** resolves against the page
`location` (its host, and `http→ws` / `https→wss`), so you just pass `"/rpc"` — no URL assembly, and
it's safe in a module a server also imports (resolution is lazy):

``` ts
const transport = Hyperlink.ws(JobsNode, { url: "/rpc" }) // → ws(s)://<page host>/rpc

const appLayer = Layer.mergeAll(
  transport,
  Hyperlink.client(Jobs).pipe(Layer.provide(transport)),
)
```

(`url` also accepts an absolute `ws://` / `wss://` url, or an `http(s)://` url with the scheme
swapped — for a Node client, or a cross-origin server.)

**3. Dev proxy** — if you proxy the RPC path in dev (same-origin, no CORS), enable WebSocket
upgrades (`ws: true`). For Vite:

``` ts
server: {
  proxy: {
    "/rpc": { target: "http://localhost:7780", changeOrigin: true, ws: true },
  },
}
```

A worked end-to-end setup is in `examples/hyperlink-web` (three nodes, one WebSocket each).

## Styling the web widgets (Tailwind)

The `hyperlink-ts/web` widgets are shadcn-style — Tailwind utility classes plus CSS-variable
theme tokens. Tailwind **does not scan `node_modules` by default**, so two things must be
wired up in the consumer or the widgets render unstyled:

1. **Scan the package** so the utilities used inside the widgets get generated.

   Tailwind v4 (in your CSS):

   ```css
   @import "tailwindcss";
   @source "../node_modules/hyperlink-ts/dist";
   ```

   Tailwind v3 (`tailwind.config`):

   ```js
   content: ["./src/**/*.{ts,tsx}", "./node_modules/hyperlink-ts/dist/**/*.js"],
   ```

2. **Define the theme tokens** the widgets reference (`--card`, `--muted-foreground`,
   `--border`, `--primary`, `--accent`, `--destructive`, `--ring`, `--radius`, …) plus the
   `.safe-area` class (device-inset padding) and the view-transition keyframes the drill-down
   uses. The shipped `src/web/theme.css` carries all of these — import it, or copy its
   `@theme inline` + `:root` + `.safe-area` + `::view-transition-*` blocks. Without
   `.safe-area` the dashboard renders edge-to-edge with no margins.

3. **Install the optional peer deps** the widgets use: `react` / `react-dom`, `recharts`
   (metric charts), and `@tanstack/react-table` (API endpoint table). See
   [Install](/docs/install).

Symptom map: widgets render **unstyled** → #1; wrong / missing colours / no margins → #2;
**module-not-found** at runtime → #3.

### Fleets — peers dial the same wire

When a node's service folds across **peers** (a `fleet` field like `fleetActive` — see
[multi-node](../guides/multi-node)), those server-to-server calls have their own transport. They
default to HTTP, so a fleet whose nodes serve WebSocket must move the peer mesh onto WebSocket too,
or the fold 404s against the ws-only `/rpc`. One knob per node, alongside `peersLayer`:

``` ts
Node.wsServer([Hyperlink.serve(WorkerPool, poolImpl) /* … */]).pipe(
  Layer.provide(Hyperlink.peersLayer(WorkerPool, ThisNode)),
  Layer.provide(Hyperlink.layerPeerProtocol(Hyperlink.protocolWebsocket)), // peers speak ws too
)
```

Under the hood every client transport is the same seam — `Hyperlink.layerProtocol(protocol)` sets a
client wire from an `RpcClient.Protocol` (build one with `Hyperlink.protocolHttp` /
`Hyperlink.protocolWebsocket`), and `ws` / `http` are per-node shortcuts over it.

## Widgets

Each HyperService kind renders a hand-crafted card, chosen by the tag's **kind** and extensible per
kind or per exact service — see [React components](react-components).
