---
"hyperlink-ts": minor
---

**`Launcher.restartSuccessor`** — `Lookup.planUpdate` → `up(B)` → shutdown `A`
(captures outgoing Directory dial before `up`). Ambient Layers:
`AlreadyUpRef` (`alreadyUpFail` / `alreadyUpAdopt`), `Lookup.PlanForce` /
`PlanStatus` (`planFailClosed` / `planForce` / `planStatusOn` /
`planStatusOff`). Per-call options still override. Example:
`examples/launcher/plan-update.ts`.
