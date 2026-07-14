/**
 * Canonical **log keys** for tests — same shapes as production `Resource.Node.key` and `Tag.key`.
 *
 * | Constant | Key kind | Key value | Used in |
 * |----------|----------|-----------|---------|
 * | `testBillingNodeKey` | node log key | `billing/scores` | `test/host-logs-history.test.ts`, `test/log-pipeline.test.ts`, … |
 * | `testRelayNodeKey` | node log key | `test/relay` | `test/logs-relay.test.ts` |
 * | `testSyncProcessKey` | resource key | `billing/SyncWorker` | `test/log-pipeline.test.ts`, `test/logs-resource.test.ts`, … |
 * | `testTuiNodeKey` | node log key | `acme/tui` | `examples/resource-tui/live-queues.ts`, `examples/resource-tui/queue-live.tsx` |
 *
 * Production equivalents: `resource-web/hub.ts` (`WnbaNode.key`, `LiveScorePoller.key`, …).
 * Full catalog: `docs/LOGS.md`.
 *
 * @internal test fixture only
 */

/** **Node log key** — durable bucket for store / pipeline / history tests. */
export const testBillingNodeKey = "billing/scores" as const;

/** **Node log key** — relay + `Node.logs` integration test. */
export const testRelayNodeKey = "test/relay" as const;

/** **Resource key** — process tag key paired with {@link testBillingNodeKey}. */
export const testSyncProcessKey = "billing/SyncWorker" as const;

/** **Node log key** — TUI example fleet (`Resource.Node` `acme/tui`). */
export const testTuiNodeKey = "acme/tui" as const;
