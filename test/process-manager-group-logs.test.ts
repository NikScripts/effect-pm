import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import {
  decodeProcessManagerLogEntryNdjson,
  encodeProcessManagerLogEntryNdjson,
  processManagerLogEntryFromLoggerOptions,
} from "../src/LogEntry";
import { replayLogEntry } from "../src/internal/manager/logCapture";
import { utcDateFromIso } from "../src/internal/utcDate";

const ndjsonRoundTripDate = utcDateFromIso("2024-01-01T00:00:00.000Z");

describe("processManagerGroupLogs", () => {
  it("round-trips a structured log entry as NDJSON", () =>
    Effect.gen(function* () {
      const entry = processManagerLogEntryFromLoggerOptions({
        message: "hello",
        logLevel: "Info",
        cause: Cause.empty,
        date: ndjsonRoundTripDate,
        annotations: { requestId: "abc" },
        spans: [["span-a", 0]],
      });
      const line = yield* encodeProcessManagerLogEntryNdjson(entry);
      const decoded = yield* decodeProcessManagerLogEntryNdjson(line.trim());
      assert.deepStrictEqual(decoded, entry);
    }));

  it.effect("replays an entry through the logger", () =>
    replayLogEntry({
      date: "2024-01-01T00:00:00.000Z",
      level: "Warn",
      message: "warn message",
      annotations: { key: "value" },
      spans: ["span-b"],
    }),
  );
});
