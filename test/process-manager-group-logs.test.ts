import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import {
  decodeProcessManagerLogEntryNdjson,
  encodeProcessManagerLogEntryNdjson,
  processManagerLogEntryFromLoggerOptions,
} from "../src/processManagerLogEntry.js";
import { replayLogEntry } from "../src/processManagerLogRelay.js";

describe("processManagerGroupLogs", () => {
  it("round-trips a structured log entry as NDJSON", () =>
    Effect.gen(function* () {
      const entry = processManagerLogEntryFromLoggerOptions({
        message: "hello",
        logLevel: "Info",
        cause: Cause.empty,
        date: new Date("2024-01-01T00:00:00.000Z"),
        annotations: { requestId: "abc" },
        spans: [["span-a", 0]],
      });
      const line = yield* encodeProcessManagerLogEntryNdjson(entry);
      const decoded = yield* decodeProcessManagerLogEntryNdjson(line.trim());
      assert.deepStrictEqual(decoded, entry);
    }));

  it.effect("replays an entry through the logger", () =>
    Effect.gen(function* () {
      yield* replayLogEntry({
        date: "2024-01-01T00:00:00.000Z",
        level: "Warn",
        message: "warn message",
        annotations: { key: "value" },
        spans: ["span-b"],
      });
    }));
});
