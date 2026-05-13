# 06 - Process lifecycle hooks

## Status

Planned.

## Intent

Add process-level lifecycle hooks as power-user extension points without hiding
the user's work under polling or schedule configuration.

Hooks should make advanced behavior easy while preserving the current mental
model:

- schedule decides whether the repeat loop is armed,
- polling decides cadence,
- `effect` remains the unit of work.

## Candidate hooks

Process lifecycle:

- `onStarted`
- `onStopped`
- `onRestarted`
- `onErrored`
- `onRecovered`

Tick lifecycle:

- `onTickStarted`
- `onTickCompleted`
- `onTickFailed`
- `onTickInterrupted`
- `onTickSettled`

Schedule lifecycle:

- `onArmed`
- `onDisarmed`
- `onScheduleEntryStarted`
- `onScheduleEntryCompleted`
- `onScheduleEntryRemoved`

## Hook controls

Hooks should receive process-bound controls where useful:

- current process name,
- current schedule ID,
- schedule controls,
- run immediately / tick now where safe,
- read current status,
- annotate logs or store event attributes.

Hooks should not accidentally create a second hidden process runtime.

## ProcessStore integration

Runtime should continue recording core lifecycle and execution events
automatically when `ProcessStore` is available.

Hooks are extension points, not the only persistence mechanism.

## Safety rules

- Hook failures should be isolated from core state transitions unless explicitly
  configured otherwise.
- Hook execution order must be documented.
- Hook effects should receive enough context to avoid yielding global services
  when the hook is meant to operate on the current process.

## Graduation criteria

- Hook names and execution order are documented.
- Hooks have typed process-bound controls.
- Tests cover success, failure, and interruption behavior.
- ProcessStore recording remains automatic and independent from hook failures.
