# Dashboard ops UI — plan (`src/ops-ui`)

**Status:** Approved plan (implementation in progress).  
**Master topology:** [dashboard-integration.md](./dashboard-integration.md).  
**Headless layer:** `@nikscripts/effect-pm/react` (shipped slices 1–2).  
**Styled layer:** `src/ops-ui/` in-repo now → future `@nikscripts/effect-pm-ops-ui` package.

---

## Goals

| Goal | Approach |
|------|----------|
| Operator UI that looks production-ready | Tailwind + shadcn + TanStack Table in `src/ops-ui` |
| Core stays Effect + control contracts | No Tailwind in `Process.ts`, `ControlService`, storage |
| WOW is mostly wire-up | Subtree of `main` + gateway + import styled dashboard |
| Fast iteration in effect-pm | Vite playground (`examples/dashboard-demo/web`) uses ops-ui |
| Clean split later | Folder seam today; pnpm workspace extraction when release cadence demands it |

**Non-goals (this arc):** analytics plane B (ProcessStore charts), Better Auth on mutations, multi-group switcher, tRPC gateway in WOW (REST first).

---

## Architecture

```text
WOW (Next) — gateway, auth, routing
    ↓ imports
src/ops-ui/  — shadcn, tables, OperatorDashboard (future export ./ops-ui)
    ↓ imports
@nikscripts/effect-pm/react  — ControlPlanePort, hooks, adapters
    ↓
ControlService @ 127.0.0.1 (Node only)
```

**Topology (unchanged):**

```text
Browser → same-origin /api/control/* → gateway → ControlService
```

---

## Repo layout (single package for now)

| Path | Role | `package.json` export |
|------|------|-------------------------|
| `src/react/` | Headless port, hooks, adapters; unstyled panels (deprecated in docs in favor of ops-ui) | `./react`, `./react/adapters/*` |
| `src/ops-ui/` | Styled components, shadcn copies, table columns | `./ops-ui` (source; add when Phase 1 lands) |
| `examples/dashboard-demo/` | Node runtime, tags, gateway template | scripts only |
| `examples/dashboard-demo/web/` | Tailwind Vite playground | not published |

**Import rules:**

- `src/ops-ui/**` may import `src/react/**` and control types.
- `src/react/**` must **not** import `src/ops-ui/**`.
- `src/Process.ts`, `ControlService.ts`, `store/**` never import React.

**Later extraction:** `src/ops-ui` → `packages/ops-ui` with `workspace:*` on effect-pm.

---

## Shipped baseline (slices 1–2)

- `ControlPlanePort`, `createFetchControlPlaneAdapter`, `createTrpcControlPlaneAdapter`
- `useControlPlaneGroupStatus`, `useControlPlaneMutation`
- `ProcessGroupControlPanel`, `QueueControlPanel`, `OperatorControlPanel` (unstyled + slots)
- Demo: `demo.runtime.ts`, queue seed, Vite proxy, `OperatorControlPanel` in demo app
- Guides: [dashboard-integration.md](./dashboard-integration.md), [dashboard-styling.md](./dashboard-styling.md)

---

## Phased implementation

### Phase 1 — Scaffold `src/ops-ui` + Tailwind in Vite demo

1. `src/ops-ui/index.ts` — public exports for styled layer.
2. `src/ops-ui/components/ui/*` — shadcn primitives (Button, Card, Alert, Table, Badge, Skeleton).
3. Tailwind + PostCSS; content paths include `src/ops-ui/**/*`.
4. `OperatorDashboard` — `ControlPlaneProvider` + layout shell.
5. Root **devDependencies** for Tailwind, shadcn stack, `@tanstack/react-table`.
6. Add `./ops-ui` to `package.json` `exports` (TypeScript source for subtree consumers).
7. Demo `web/App.tsx` imports `OperatorDashboard` from ops-ui.

**Acceptance:** `example:dashboard-demo:pm` + `:ui` → styled ops console.

### Phase 2 — TanStack Table

1. `ProcessStatusTable` — name, status, uptime, armed, actions.
2. `QueueStatusTable` — name, sizes, completed, actions.
3. Single shared poll via `useControlPlaneGroupStatus`.
4. Loading / error / empty via shadcn.
5. Light unit tests for formatters/column helpers.

**Acceptance:** Tables replace unstyled list panels in demo.

### Phase 3 — WOW contract

1. Update [wow-dashboard handoff](../handoffs/wow-dashboard-slice-2-agent-prompts.md) (slice 3b: import `./ops-ui`).
2. Document WOW `tailwind.config` **content** must scan subtree `src/ops-ui/**`.
3. Gateway REST map unchanged; env `PM_CONTROL_URL`.

### Phase 4 — Later

- TanStack Query; tRPC gateway in WOW; charts (plane B); monorepo publish `@nikscripts/effect-pm-ops-ui`; trim unstyled exports from `./react`.

---

## Dependencies (single package)

| Dependency | Where | Notes |
|------------|--------|------|
| `react`, `react-dom`, `effect` | peers on core | unchanged |
| `tailwindcss`, shadcn stack, `@tanstack/react-table` | root **devDependencies** | ops-ui only; core `tsup` does not bundle ops-ui until separate build entry |

---

## WOW / subtree

| Topic | Policy |
|-------|--------|
| Sync ref | **`main` only** (record SHA in WOW PRs) |
| Subtree | Whole repo; depend on `@nikscripts/effect-pm` + `@nikscripts/effect-pm/ops-ui` |
| WOW owns | gateway, auth, layout shell, `PM_CONTROL_URL` |
| effect-pm owns | runtime, control API, headless + styled widgets |

---

## Verification (each phase)

```bash
pnpm run typecheck
pnpm test
pnpm run build    # core dist; ops-ui may be source-only initially
pnpm run lint
pnpm run example:dashboard-demo:pm   # terminal A
pnpm run example:dashboard-demo:ui   # terminal B
```

---

## Product decisions (locked)

| # | Decision |
|---|----------|
| 1 | Styled code in **`src/ops-ui/`** (not only under examples) |
| 2 | WOW import via **`./ops-ui`** export |
| 3 | Unstyled `./react` panels **kept** but **deprecated** in docs |
| 4 | Tailwind deps at **repo root** devDependencies |
| 5 | Polling hooks first; **no** TanStack Query in this arc |
| 6 | Separate **Process** + **Queue** tables |
| 7 | **No** charts in this arc |
| 8 | Demo uses **styled** app only (retire inline-style `App.tsx`) |
| 9 | Future package name: **`@nikscripts/effect-pm-ops-ui`** |

Align Tailwind major version and shadcn theme with WOW when known.

---

## Related

| Doc | Purpose |
|-----|---------|
| [dashboard-integration.md](./dashboard-integration.md) | Gateway topology, `ControlPlanePort` |
| [dashboard-styling.md](./dashboard-styling.md) | Headless vs ops-ui, Tailwind content paths |
| [../handoffs/dashboard-ops-ui-local-agent.md](../handoffs/dashboard-ops-ui-local-agent.md) | Local agent prompt (Phase 1+) |
| [../handoffs/wow-dashboard-slice-2-agent-prompts.md](../handoffs/wow-dashboard-slice-2-agent-prompts.md) | WOW gateway + subtree |
