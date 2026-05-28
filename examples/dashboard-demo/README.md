# Dashboard control demo

Proves the slice‑1 topology from [dashboard-integration.md](../../docs/guides/dashboard-integration.md):

```text
Browser → /api/control (gateway) → ControlService (127.0.0.1:3001)
```

## Run (two terminals)

**Terminal A — process manager + control API**

```bash
pnpm run example:dashboard-demo:pm
```

**Terminal B — Vite UI (proxies `/api/control`)**

```bash
pnpm run example:dashboard-demo:ui
```

Open http://localhost:5173 — control **dashboard-tick** and **dashboard-demo-queue** from the ops UI.

Styled widgets come from **`src/ops-ui`** (see [dashboard-ops-ui.md](../../docs/guides/dashboard-ops-ui.md)). Until Phase 1 lands, the demo may use headless `@nikscripts/effect-pm/react` panels.

## Optional standalone gateway

When the UI is not served by Vite, forward with:

```bash
pnpm run example:dashboard-demo:gateway
```

Point the UI `baseUrl` at `http://127.0.0.1:3100/api/control` (see `control-gateway.ts`).

## Files

| File | Role |
| --- | --- |
| `demo.tags.ts` | Browser-safe `Process` / `ProcessGroup` tags |
| `demo.runtime.ts` | Node layers + `ControlService.layerHttp` |
| `web/` | Vite + Tailwind; imports `@nikscripts/effect-pm/ops-ui` (or headless `react` during migration) |
| `control-gateway.ts` | Copy-paste noop forwarder template |
