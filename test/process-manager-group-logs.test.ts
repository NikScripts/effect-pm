import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  readLogBytesSince,
  tailTextLines,
} from "../src/processManagerGroupLogs.js";

describe("processManagerGroupLogs", () => {
  it("tails the last N lines", () => {
    const text = ["one", "two", "three", "four"].join("\n") + "\n";
    expect(tailTextLines(text, 2)).toBe("three\nfour\n");
    expect(tailTextLines("", 10)).toBe("");
  });

  it.effect("reads appended bytes from an offset", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = ".effect-pm-test/group-logs-append.log";
      yield* fs.makeDirectory(".effect-pm-test", { recursive: true });
      yield* fs.writeFileString(path, "alpha\n");
      const first = yield* readLogBytesSince(path, 0);
      expect(first.text).toBe("alpha\n");
      expect(first.nextOffset).toBeGreaterThan(0);
      yield* fs.writeFileString(path, "alpha\nbeta\n", { flag: "w" });
      const second = yield* readLogBytesSince(path, first.nextOffset);
      expect(second.text).toBe("beta\n");
      yield* fs.remove(".effect-pm-test", { recursive: true, force: true }).pipe(
        Effect.catch(() => Effect.void),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
