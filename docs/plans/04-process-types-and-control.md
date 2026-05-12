# 04 — Process types & schedule control (planned)

> **Superseded for Process runtime & DX** by [09 — Process runtime](./09-process-runtime.md).  
> Do not implement multi-schedule reconciler flows for `Process` unless 09 is
> amended. This file remains as background for earlier design discussion.

## Goal

Beyond a single cron-backed `Process.make`:

- Process variants: base (no schedule), single schedule, multi-schedule with **typed schedule keys**.
- **ProcessControl** — Effect-scoped service for `switchSchedule`, `sleepUntil`, `sleepFor`, `clearSleep`, metadata setters — distinct from HTTP **ControlService**.

## Status

Not implemented. Current code path is `Process.make` + cron only.

## When implemented

- Control mutations update **target** intent; reconciler converges **live** (see `05-state-and-reconciler.md` once that exists).
