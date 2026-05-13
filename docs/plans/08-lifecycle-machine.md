# 08 - Lifecycle machine

## Status

Candidate plan.

## Intent

Explore an internal typed lifecycle kernel for runtime state transitions.

This is inspired by state-machine ideas, but it should not copy an unstable
external prototype wholesale. Start with `effect-pm` domain needs.

## Goals

- make legal transitions explicit,
- expose enabled actions,
- simplify tests,
- support projections from events,
- improve control-service eligibility checks,
- keep runtime behavior Effect-native.

## Non-goals

- full XState clone,
- public generic workflow DSL in the first pass,
- nested statecharts before concrete runtime need,
- broad target/live reconciler architecture.

## Candidate domains

Queue lifecycle:

- running,
- paused,
- shutting down,
- shutdown,
- cleared.

Queue item lifecycle:

- queued,
- processing,
- completed,
- failed,
- retry scheduled,
- exhausted,
- dead-lettered.

Process lifecycle:

- stopped,
- starting,
- running,
- stopping,
- restarting,
- failed.

Schedule entry lifecycle:

- pending,
- sleeping,
- running,
- removed,
- completed,
- expired.

## Shape

Prefer a pure transition core:

- `state + event -> next state + commands`
- commands run in Effect outside the pure transition,
- `enabled(state)` reports allowed events,
- `graph(machine)` supports docs and tooling,
- snapshots/events can be serialized where useful.

## Adoption path

Start with queue lifecycle because it is bounded and lower risk. Do not rewrite
process schedule runtime first.

## Graduation criteria

- Internal kernel has no unsafe public type surface.
- Queue lifecycle uses it successfully.
- Tests demonstrate enabled actions and rejected transitions.
- Control service can consume enabled actions.
- A later decision is made before public export.
