---
"@nikscripts/effect-pm": minor
---

**BREAKING:** Rename the in-process orchestrator from `ProcessManager` to **`ProcessGroup`**.

- `ProcessManager.make` → `ProcessGroup.make`; file and types renamed accordingly (`ProcessGroupControls`, `ProcessGroupDetails`, `ProcessGroupState`, `ProcessGroupErrors`, etc.).
- **`ProcessManager`** is reserved for a future multi-group coordinator (not implemented). See `docs/plans/08-process-manager-future.md`.
- `ControlService.make` / low-level HTTP control: option **`pm`** renamed to **`group`** (`{ group, port }`).
- Docs and examples updated; architecture plans consolidated under `docs/plans/`.
