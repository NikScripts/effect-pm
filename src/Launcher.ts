/**
 * **Launcher** — short-lived spawn-and-exit bring-up (spine α).
 *
 * Consume as `import * as Launcher from "hyperlink-ts/Launcher"`.
 *
 * Phases: {@link spawn} → {@link Handle.awaitReady} → {@link Handle.handoff}
 * (convenience {@link up}). Ownership ack is {@link Node.assume} on the child;
 * Ready uses existing `withReadiness` / node status. Node-platform only
 * (`ChildProcessSpawner` + `Scope` at the app edge — provide {@link layer}).
 *
 * Observability: phases log under spans `launcher.spawn` / `launcher.awaitReady` /
 * `launcher.handoff` (both Effect log spans and OTEL `withSpan`) with annotations
 * `launcher.node`, `launcher.phase`, and (on spawn) `launcher.pid`. Effect `Metric`s:
 * `launcher_ready_duration_ms`, `launcher_ready_timeout_total`,
 * `launcher_child_exited_total`, `launcher_handoff_total{outcome}`. Assume tokens are
 * branded {@link Token} + `Redacted` and never logged. Ready timeout/poll Config is
 * resolved at {@link spawn}. Ready timeout kill-reaps the child (fail-closed);
 * {@link Handle.kill} is also public.
 *
 * Errors: {@link ReadyTimedOut}, {@link ChildExited}, {@link HandleSpent},
 * {@link HandleNotReady}, plus assume / reachability failures from `Node.assume`.
 *
 * @see `docs/guides/launcher.md`
 * @module Launcher
 */
export {
  mintToken,
  spawn,
  up,
  command,
  entry,
  layer,
  readyTimeoutConfig,
  readyPollConfig,
  ReadyTimedOut,
  ChildExited,
  HandleSpent,
  HandleNotReady,
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
} from "./internal/launcher";
