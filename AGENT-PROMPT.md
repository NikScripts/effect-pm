# Hub agent — post-transport-merge; bake before more telemetry code

**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt`  
**Branch:** `cursor/hub-runresource-vertical`  
**Tmux session:** `effect-pm-alt`

**Stop:** Do not extend `defineEvent` / `RunResourceHubTelemetry`. Run bake first:
[telemetry-split-bake.md](./docs/recipes/telemetry-split-bake.md).

---

## Shipped on this branch

| Area | Status |
| --- | --- |
| `TelemetryHub` + sinks | Shipped — router only (definitions must move to `Telemetry.Service`) |
| Transport 6.4–6.6 | Merged |
| `RunResourceStore` without telemetry section | Shipped |
| `RunResourceProjection` pilot | Shipped |
| Flat `store/RunResource*.ts` | Shipped |

## Debt (replace after bake)

| Item | Target |
| --- | --- |
| `RunResourceTelemetry.ts` | `Telemetry.Service` + plan 17 tree from `facet-telemetry-158c` |
| `RunResource.ts` `stateRef` | Telemetry state (in-memory) or emit legs — not kernel |
| `Telemetry.registry` | Not built |
| Telemetry state module | Not built — [21-state-vocabulary.md](./docs/plans/21-state-vocabulary.md) |

---

## Read first

1. [telemetry-split-bake.md](./docs/recipes/telemetry-split-bake.md)
2. [21-state-vocabulary.md](./docs/plans/21-state-vocabulary.md)
3. [architecture-split-and-transports.md](./docs/recipes/architecture-split-and-transports.md)
4. [20-process-store-split-and-telemetry.md](./docs/plans/20-process-store-split-and-telemetry.md)

---

## Verification

```sh
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```
