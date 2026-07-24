import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { LogAnnotationKeys } from "../src/LogContext";
import { logEntryMatchesScope, resolveLogScope } from "../src/internal/manager/logScope";
import type { LogEntry } from "../src/LogEntry";

import { testBillingNodeKey, testSyncDaemonKey } from "./fixtures/logKeys";
import { kind as daemonKind } from "../src/Daemon";

const entry = (
  annotations: LogEntry["annotations"],
): LogEntry => ({
  date: "2024-01-01T00:00:00.000Z",
  level: "Info",
  message: "hello",
  annotations,
  spans: [],
});

describe("logContext", () => {
  it("matches process scope by lineage key", () => {
    const scope = {
      _tag: daemonKind,
      groupId: testBillingNodeKey,
      key: testSyncDaemonKey,
    };
    assert.strictEqual(
      logEntryMatchesScope(
        entry({
          [LogAnnotationKeys.lineage]: JSON.stringify([testSyncDaemonKey]),
        }),
        scope,
      ),
      true,
    );
    assert.strictEqual(
      logEntryMatchesScope(
        entry({
          [LogAnnotationKeys.lineage]: JSON.stringify(["billing/OtherWorker"]),
        }),
        scope,
      ),
      false,
    );
  });

  it("resolves a process target without a group flag", () =>
    Effect.gen(function* () {
      const scope = yield* resolveLogScope(
        [{ key: testBillingNodeKey }],
        Option.some("SyncWorker"),
        [
          {
            key: testSyncDaemonKey,
            kind: daemonKind,
            groupId: testBillingNodeKey,
            controls: [],
          },
        ],
      );
      assert.strictEqual(scope._tag, daemonKind);
      if (scope._tag === daemonKind) {
        assert.strictEqual(scope.groupId, testBillingNodeKey);
        assert.strictEqual(scope.key, testSyncDaemonKey);
      }
    }));
});
