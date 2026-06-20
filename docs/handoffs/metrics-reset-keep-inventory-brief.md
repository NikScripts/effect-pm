# Reset brief — identify what to keep (Phase 1: inventory only)

**Branch:** `metrics-reset` (cut fresh from `main` @ `b12d54b7f`). This is the clean line where kept work + the new metrics design will live. **Do not** carry the cancelled subsystem onto it.

## What happened
The `cursor/telemetry-redesign-bake-faed` branch is **246 commits ahead of `main`** (main is not ahead). A large bespoke **Telemetry + State** subsystem was being designed there. It is **CANCELLED.** We're pivoting to use Effect's built-in `Metric` (and spans) directly — standard, invisible, no bespoke model. The only new thing we add is a small "observable metric" helper (snapshot + push-on-update, since Effect `Metric` can't be subscribed to).

The cancelled branch also contains a lot of **keep-worthy work unrelated to telemetry** (ops-ui dashboard, transports, auth, process lifecycle, react, CLI). We must salvage that and drop the rest.

## Your task — PHASE 1 ONLY: inventory what to KEEP
**Read-only.** Do NOT modify files, do NOT change git state (no checkout/branch/reset/commit/cherry-pick), do NOT do any cleanup or transplant yet. Just produce the inventory. Compare by explicit refs (checkout-independent):
```
git diff main...cursor/telemetry-redesign-bake-faed
git log  main..cursor/telemetry-redesign-bake-faed
```

Bucket **every** changed file/area into:

1. **DROP** — purely the cancelled Telemetry/State subsystem. Known files (verify + find more): `src/State.ts`, `src/Telemetry.ts`, `src/TelemetryHub.ts`, `src/TelemetryRouter.ts`, `src/telemetryTransport.ts`, `src/internal/store/telemetry.ts`, `src/internal/telemetryHub/dispatch.ts`, `src/internal/telemetryHub/state.ts`, `src/store/RunResourceTelemetry.ts`, `src/store/queueResourceTelemetry.ts`, and the `docs/handoffs/telemetry-*` / `telemetry-redesign-decisions.md` / `telemetry-api-surface.md` docs (+ related recipes/plans).
2. **KEEP (clean)** — genuinely useful work that never touches State/Telemetry. Group by subsystem (ops-ui, transports `StoreTransportRpc`/`ControlTransport*`, `CommandAuth`, `processLifecycle`/`processExecution`/`processGroup`, `react/*`, `bin`/CLI, queue/store work, …). One line each on what it is.
3. **MIXED** — keep-worthy files that **import/call** State/Telemetry and need detangling. ~15 known: `ProcessManager`, `ProcessStore`, the `*Scope` files, `internal/runResource/kernel`, `store/RunResource*`, `store/queueResource`, `index.ts`. For each: the file, exactly what telemetry/State it pulls in (imports, call sites, types) with `file:line`, and what must be stripped/replaced to keep it. **This list sizes the whole job.**

## Output format (so the owner can confirm item-by-item)
A scannable, **itemized** list — each KEEP/MIXED item numbered, with file(s) + a one-line description, so the owner can approve or reject each one individually. End with a short **transplant-strategy** note (cherry-pick ranges vs file-snapshot vs squashed salvage commit) given the entanglement.

## After inventory
Owner reviews and **confirms each item.** Cleanup/transplant happens **only after** confirmation — that's Phase 2, not now.

## Workflow / worktree model
- Spin this agent up in its **own worktree**, branched off `metrics-reset` (so the line can fast-forward later).
- Phase 1 (inventory, read-only) and Phase 2 (cleanup/transplant, after per-item confirmation) both happen in that worktree.
- The primary worktree stays on `metrics-reset` for the owner's metrics-design work. **Only one side commits to the `metrics-reset` line at a time** — while this agent is working, the owner holds design commits, so `metrics-reset` can `merge --ff-only` to the agent's branch when done. Design then builds on top.
