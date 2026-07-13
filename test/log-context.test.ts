import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { logEntryMatchesScope, resolveLogScope } from "../src/internal/manager/logScope";
import type { LogEntry } from "../src/LogEntry";

import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

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
  it("matches process scope by annotation", () => {
    const scope = {
      _tag: "process" as const,
      groupId: testBillingNodeKey,
      processId: testSyncProcessKey,
    };
    assert.strictEqual(
      logEntryMatchesScope(
        entry({
          groupId: testBillingNodeKey,
          processId: testSyncProcessKey,
        }),
        scope,
      ),
      true,
    );
    assert.strictEqual(
      logEntryMatchesScope(
        entry({ groupId: testBillingNodeKey, processId: "billing/OtherWorker" }),
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
            key: testSyncProcessKey,
            kind: "process",
            groupId: testBillingNodeKey,
            controls: [],
          },
        ],
      );
      assert.strictEqual(scope._tag, "process");
      if (scope._tag === "process") {
        assert.strictEqual(scope.groupId, testBillingNodeKey);
        assert.strictEqual(scope.processId, testSyncProcessKey);
      }
    }));
});
