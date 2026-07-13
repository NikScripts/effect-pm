/**
 * Canonical **log keys** for tests — same shapes as production `Resource.Node.key` and `Tag.key`.
 *
 * | Constant | Key kind | Key value | Used in |
 * |----------|----------|-----------|---------|
 * | `testBillingNodeKey` | node log key | `billing/scores` | `test/host-logs-history.test.ts`, `test/log-pipeline.test.ts`, … |
 * | `testRelayNodeKey` | node log key | `test/relay` | `test/logs-relay.test.ts` |
 * | `testSyncProcessKey` | resource key | `billing/SyncWorker` | `test/log-pipeline.test.ts`, `test/log-store-facet.test.ts`, … |
 *
 * Production equivalents: `resource-web/hub.ts` (`WnbaNode.key`, `LiveScorePoller.key`, …).
 * Full catalog: `docs/LOGS.md`.
 *
 * @internal test fixture only
 */

/** **Node log key** — durable bucket for store / pipeline / history tests. */
export const testBillingNodeKey = "billing/scores" as const;

/** **Node log key** — relay `persistLayer` integration test. */
export const testRelayNodeKey = "test/relay" as const;

/** **Resource key** — process tag key paired with {@link testBillingNodeKey}. */
export const testSyncProcessKey = "billing/SyncWorker" as const;
