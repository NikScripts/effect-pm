/**
 * **Launcher** — short-lived spawn-and-exit bring-up (spine α).
 *
 * Consume as `import * as Launcher from "hyperlink-ts/Launcher"`.
 *
 * Phases: {@link spawn} → {@link Handle.awaitReady} → {@link Handle.handoff}
 * (convenience {@link up}). Ownership ack is {@link Node.assume} on the child;
 * Ready uses existing `withReadiness` / node status. Node-platform only
 * (`ChildProcessSpawner` + `Scope` at the app edge).
 *
 * Observability: phases log under spans `launcher.spawn` / `launcher.awaitReady` /
 * `launcher.handoff` (both Effect log spans and OTEL `withSpan`) with annotations
 * `launcher.node`, `launcher.phase`, and (on spawn) `launcher.pid`. Assume tokens are
 * `Redacted` and never logged. Ready bound defaults via {@link readyTimeoutConfig}.
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
  readyTimeoutConfig,
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
} from "./internal/launcher";
