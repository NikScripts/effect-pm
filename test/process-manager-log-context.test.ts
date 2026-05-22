import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { logEntryMatchesScope, resolveLogScope } from "../src/processManagerLogContext.js";
import type { ProcessManagerLogEntry } from "../src/processManagerLogEntry.js";

const entry = (
  annotations: ProcessManagerLogEntry["annotations"],
): ProcessManagerLogEntry => ({
  date: "2024-01-01T00:00:00.000Z",
  level: "Info",
  message: "hello",
  annotations,
  spans: [],
});

describe("processManagerLogContext", () => {
  it("matches process scope by annotation", () => {
    const scope = {
      _tag: "process" as const,
      groupId: "workshop-group",
      processId: "billing/sync",
    };
    assert.strictEqual(
      logEntryMatchesScope(
        entry({
          groupId: "workshop-group",
          processId: "billing/sync",
        }),
        scope,
      ),
      true,
    );
    assert.strictEqual(
      logEntryMatchesScope(
        entry({ groupId: "workshop-group", processId: "other" }),
        scope,
      ),
      false,
    );
  });

  it("resolves a process target without a group flag", () =>
    Effect.gen(function* () {
      const scope = yield* resolveLogScope(
        [{ id: "workshop-group" }],
        Option.some("sync"),
        [
          {
            id: "billing/sync",
            kind: "process",
            groupId: "workshop-group",
            controls: [],
          },
        ],
      );
      assert.strictEqual(scope._tag, "process");
      if (scope._tag === "process") {
        assert.strictEqual(scope.groupId, "workshop-group");
        assert.strictEqual(scope.processId, "billing/sync");
      }
    }));
});
