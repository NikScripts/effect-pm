import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Fiber, Stream } from "effect";
import * as Logs from "../src/Logs";
import * as Store from "../src/Store";
import { testRelayNodeKey } from "./fixtures/logKeys";
import * as Node from "../src/Node";

class RelayNode extends Node.Service<RelayNode>()(testRelayNodeKey) {}
class RelayStore extends Store.Service<RelayStore>("@test/logs-relay/Store")(
  RelayNode.logs,
) {}

describe("Logs relay", () => {
  it.live("layer captures one relay entry per log line", () =>
    Effect.gen(function* () {
      const collected = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.filter(Logs.stream, (e) => e.message === "relay-once"),
            1,
          ),
        ),
      );
      yield* Effect.sleep(Duration.millis(20));
      yield* Effect.logInfo("relay-once");
      const entry = Array.from(yield* Fiber.join(collected))[0];
      expect(entry?.message).toBe("relay-once");
    }).pipe(Effect.provide(Logs.layer), Effect.scoped),
  );

  it.live("Node.logs durable tail follows the same capture path", () =>
    Effect.gen(function* () {
      yield* Effect.logInfo("persist-subscriber");
      yield* Effect.gen(function* () {
        while ((yield* Logs.byNode(RelayNode)).length === 0) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));
      const rows = yield* Logs.byNode(RelayNode);
      expect(rows.some((row) => row.message === "persist-subscriber")).toBe(true);
    }).pipe(Effect.provide(RelayStore.layerMemory), Effect.scoped),
  );
});
