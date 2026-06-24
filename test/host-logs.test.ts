import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Stream } from "effect";
import { HostLogs } from "../src/HostLogs";

describe("HostLogs — runtime-wide log capture", () => {
  it.live("captures a bare (untagged) Effect.log with level + message", () =>
    Effect.gen(function* () {
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(HostLogs.stream, (e) =>
              e.message.includes("host-log-test"),
            ),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      // a plain log, attached to no resource/tag — Host logs must still capture it
      yield* Effect.logInfo("host-log-test bare line");
      const entry = Array.from(yield* Fiber.join(collected))[0];
      expect(entry?.message).toContain("host-log-test bare line");
      expect(entry?.level).toBe("Info");
    }).pipe(Effect.provide(HostLogs.layer), Effect.scoped),
  );

  it.live("a late subscriber replays the recent tail", () =>
    Effect.gen(function* () {
      yield* Effect.logWarning("host-log-test earlier");
      yield* Effect.sleep(Duration.millis(20)); // let the scheduled publish land
      // subscribe AFTER the line was emitted — the relay tail must replay it
      const replayed = yield* Stream.runHead(
        Stream.filter(HostLogs.stream, (e) =>
          e.message.includes("host-log-test earlier"),
        ),
      );
      expect(replayed._tag).toBe("Some");
    }).pipe(Effect.provide(HostLogs.layer), Effect.scoped),
  );
});
