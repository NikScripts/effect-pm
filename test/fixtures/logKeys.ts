/**
 * Canonical log keys for tests — same shapes as {@link Resource.Node.key} and resource `tag.key`.
 *
 * @internal test fixture only
 */

/** Node log bucket (`Resource.Node.key`) for store / pipeline / history tests. */
export const testBillingNodeKey = "billing/scores" as const;

/** Node log bucket for relay `persistLayer` integration. */
export const testRelayNodeKey = "test/relay" as const;

/** Resource key (`Resource.Tag.key`) paired with {@link testBillingNodeKey}. */
export const testSyncProcessKey = "billing/SyncWorker" as const;
