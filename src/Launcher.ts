/**
 * **Launcher** — short-lived spawn-and-exit bring-up (spine α).
 *
 * Consume as `import * as Launcher from "hyperlink-ts/Launcher"`.
 *
 * Phases: {@link spawn} → {@link Handle.awaitReady} → {@link Handle.handoff}
 * (convenience {@link up}). Abort with {@link Handle.kill}. Ownership ack is
 * {@link Node.assume} on the child; Ready uses existing `withReadiness` / node status.
 * Ensure-Lookup-first: {@link ensureLookup} (or {@link UpOptions.lookup}) adopts a live
 * Lookup or spawns a Lookup-only child before app units — never Soft-bakes onto apps.
 * App already-up: ambient {@link AlreadyUpRef} (default fail → {@link NodeAlreadyUp});
 * {@link alreadyUpAdopt} or per-call `"adopt"` skips spawn (Ready-proved; no Handle).
 * Single-step cutover: {@link restartSuccessor} = plan → up B → Advice.prefer(B) →
 * shutdown A. Prefer fleet-shaped `Update.plan` → `simulate` → `execute`
 * (`hyperlink-ts/Update`) for new apps.
 * Node-platform only (`ChildProcessSpawner` + `Scope` at the app edge — provide {@link layer}).
 *
 * Observability: phases log under spans `launcher.spawn` / `launcher.awaitReady` /
 * `launcher.handoff` / `launcher.kill` (Effect log spans + OTEL `withSpan`) with annotations
 * `launcher.node`, `launcher.phase`, and (on spawn) `launcher.pid`. Effect `Metric`s:
 * `launcher_ready_duration_ms`, `launcher_ready_timeout_total`,
 * `launcher_child_exited_total`, `launcher_handoff_total{outcome}`. Assume tokens are
 * branded {@link Token} + `Redacted` and never logged. Ready timeout/poll Config is
 * resolved at {@link spawn}. Ready timeout kill-reaps the child (fail-closed).
 *
 * Errors: {@link ReadyTimedOut}, {@link ChildExited}, {@link HandleSpent},
 * {@link HandleNotReady}, {@link NodeAlreadyUp}, plus assume / reachability failures
 * from `Node.assume`.
 *
 * @see `docs/guides/launcher.md`
 * @module Launcher
 */
export {
  mintToken,
  spawn,
  up,
  ensureLookup,
  restartSuccessor,
  command,
  entry,
  layer,
  readyTimeoutConfig,
  readyPollConfig,
  AlreadyUpRef,
  alreadyUp,
  alreadyUpFail,
  alreadyUpAdopt,
  ReadyTimedOut,
  ChildExited,
  HandleSpent,
  HandleNotReady,
  LookupNotRunning,
  LookupAddressRequired,
  NodeAlreadyUp,
} from "./internal/launcher";
export type {
  Handle,
  SpawnSpec,
  ReadyOptions,
  Token,
  TokenInjection,
  CommandOptions,
  EntryOptions,
  ServiceRef,
  UpOptions,
  EnsureLookupOptions,
  EnsureLookupResult,
  RestartSuccessorOptions,
  AlreadyUp,
} from "./internal/launcher";
