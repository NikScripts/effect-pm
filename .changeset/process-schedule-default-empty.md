---
"@nikscripts/effect-pm": minor
---

Change `Process.make` default schedule from empty in-memory storage to `ProcessSchedule.alwaysArmed` when both `schedule` and `scheduleLayer` are omitted. Add `ProcessSchedule.empty` for apps that relied on the previous disarmed-until-mutation default — pass `schedule: ProcessSchedule.empty` to restore that behavior.
