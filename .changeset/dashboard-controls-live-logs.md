---
"@nikscripts/effect-pm": minor
---

Add headless React dashboard primitives and a styled ops-ui shell for adaptive controls and live logs.

This introduces browser-safe dashboard target types, `<Controls for={...} />`, `<Logs for={...} />`, `useControlPlaneLogs`, and `ControlPlanePort.logs(...)` with live-following NDJSON log streams plus bounded history parameters. It also adds the `@nikscripts/effect-pm/ops-ui` export with `OperatorDashboard` for a production-oriented dashboard shell, icon-only action buttons, status tables, terminal-style live logs, a styled log toolbar, a persisted resizable dashboard grid layout, shadcn-generated local UI components, bounded scrollable widgets, and persisted dashboard chrome visibility state.
