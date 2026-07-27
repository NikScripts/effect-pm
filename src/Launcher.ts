/**
 * **Launcher** — short-lived spawn-and-exit bring-up (spine α).
 *
 * Consume as `import * as Launcher from "hyperlink-ts/Launcher"`.
 *
 * Phases: {@link spawn} → {@link Handle.awaitReady} → {@link Handle.handoff}
 * (convenience {@link up}). Ownership ack is {@link Node.assume} on the child;
 * Ready uses existing `withReadiness` / node status. Node-platform only.
 *
 * @module Launcher
 */
export {
  mintToken,
  spawn,
  up,
  ReadyTimedOut,
  ChildExited,
  HandleSpent,
} from "./internal/launcher";
export type {
  Handle,
  SpawnSpec,
  ReadyOptions,
  Token,
} from "./internal/launcher";
