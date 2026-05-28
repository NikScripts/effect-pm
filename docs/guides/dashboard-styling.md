# Dashboard widgets — styling (Tailwind, shadcn, TanStack Table)

**Styled product UI** lives in **`src/ops-ui/`** (future `@nikscripts/effect-pm-ops-ui`). See [dashboard-ops-ui.md](./dashboard-ops-ui.md).

`@nikscripts/effect-pm/react` ships **headless data hooks**, **optional render slots**, and **unstyled defaults**. It does **not** bundle Tailwind, shadcn/ui, or TanStack Table.

## Why peers are optional, not required

| Dependency | In package? | WOW / your app |
|------------|-------------|----------------|
| `react`, `react-dom` | **peer** (required for widgets) | Install |
| `effect` | **peer** (types / schemas) | Already have |
| `tailwindcss` | **not** a peer | Your app config |
| shadcn/ui | **not** a peer (copy-paste in app) | `components/ui/*` |
| `@tanstack/react-table` | **optional peer** | Tables in WOW |
| `@tanstack/react-query` | **optional peer** | When you add RQ hooks later |
| `@trpc/client` | **optional peer** (via `react/adapters/trpc`) | tRPC gateway |

Optional peers are declared so tooling knows compatible versions; installs stay in the **application**, not in effect-pm.

## Recommended WOW stack

1. **Tailwind** — layout and tokens for ops pages.
2. **shadcn/ui** — `Button`, `Card`, `Alert`, `Table`, `Badge` for status rows.
3. **Slots** on `ProcessGroupControlPanel` / `QueueControlPanel` — wire shadcn components without forking the package.

## Slot API (shadcn-friendly)

```tsx
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ProcessGroupControlPanel,
  type ProcessGroupControlPanelSlots,
} from "@nikscripts/effect-pm/react";

const slots: ProcessGroupControlPanelSlots = {
  error: ({ message }) => (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ),
  actionButton: ({ action, disabled, onClick }) => (
    <Button size="sm" variant="outline" disabled={disabled} onClick={onClick}>
      {action}
    </Button>
  ),
  processRow: ({ process, uptimeLabel, actions }) => (
    <li className="flex items-center justify-between border-b py-2">
      <div>
        <p className="font-medium">{process.name}</p>
        <p className="text-muted-foreground text-sm">
          {process.status} · {uptimeLabel}
        </p>
      </div>
      <div className="flex gap-1">{actions}</div>
    </li>
  ),
};

<ProcessGroupControlPanel className="space-y-4" slots={slots} />;
```

Use **`OperatorControlPanel`** with `sharedStatus` from **`useControlPlaneGroupStatus`** when you build a custom layout (single poll, shadcn grid).

## Headless hooks (full custom UI)

```tsx
import {
  ControlPlaneProvider,
  useControlPlaneGroupStatus,
  useControlPlane,
} from "@nikscripts/effect-pm/react";

function CustomOpsTable() {
  const { processes, queues, loading, error, refresh } = useControlPlaneGroupStatus({
    pollIntervalMs: 3000,
  });
  const port = useControlPlane();
  // Feed processes/queues into @tanstack/react-table — your columns, your shadcn Table
}
```

## Tables and charts (later)

- **Tables:** `@tanstack/react-table` + shadcn `Table` in WOW; data from `useControlPlaneGroupStatus` or analytics tRPC (plane B, separate router).
- **Charts:** plane B / `ProcessStore` projections (plan 04) — not control plane widgets.

## Demo playground

`examples/dashboard-demo/web` uses **Tailwind** and imports from **`src/ops-ui`** (once Phase 1 lands). WOW must add subtree `src/ops-ui/**` to **Tailwind `content`** when consuming styled widgets.

## WOW import (styled)

```tsx
import { OperatorDashboard } from "@nikscripts/effect-pm/ops-ui";
import { createFetchControlPlaneAdapter } from "@nikscripts/effect-pm/react/adapters/fetch";
```

Provide `ControlPlaneProvider` + port in the app shell, or use `OperatorDashboard` if it wraps both.

## Related

- [dashboard-ops-ui.md](./dashboard-ops-ui.md) — phased plan
- [dashboard-integration.md](./dashboard-integration.md) — topology and adapters
- [service-tags-and-runtime-split.md](./service-tags-and-runtime-split.md) — tags vs runtime
