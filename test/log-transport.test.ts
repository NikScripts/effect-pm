import { RpcTest } from "effect/unstable/rpc";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import {
  LogRpc,
  logTransport,
  ProcessManagerLogAnnotationKeys,
  ProcessManagerLogRelay,
  type ProcessManagerLogEntry,
} from "../src";
import { relayOnlyLayer } from "../src/Logs";

const entry = (
  message: string,
  annotations: ProcessManagerLogEntry["annotations"] = {},
): ProcessManagerLogEntry => ({
  date: "2026-06-02T00:00:00.000Z",
  level: "Info",
  message,
  annotations,
  spans: [],
});

describe("logTransport", () => {
  it.live("streams live entries through in-memory Effect RPC", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rpcClient = yield* RpcTest.makeClient(LogRpc).pipe(
          Effect.provide(logTransport.live),
        );
        const client = logTransport.makeClient(rpcClient);
        const relay = yield* ProcessManagerLogRelay;

        const collectedFiber = yield* client.stream({
          follow: true,
          preludeLines: 0,
        }).pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );

        yield* Effect.yieldNow;
        yield* relay.publish(entry("live transport log"));

        const collected = yield* Fiber.join(collectedFiber);
        assert.deepStrictEqual(
          collected.map((item) => item.message),
          ["live transport log"],
        );
      }).pipe(
        Effect.provide(relayOnlyLayer),
      ),
    ),
  );

  it.live("filters snapshot prelude by semantic process scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const rpcClient = yield* RpcTest.makeClient(LogRpc).pipe(
          Effect.provide(logTransport.live),
        );
        const client = logTransport.makeClient(rpcClient);
        const relay = yield* ProcessManagerLogRelay;
        const groupId = "@test/LogTransportGroup";
        const processId = `${groupId}/SyncInvoices`;

        yield* relay.publish(entry("process log", {
          [ProcessManagerLogAnnotationKeys.groupId]: groupId,
          [ProcessManagerLogAnnotationKeys.processId]: processId,
        }));
        yield* relay.publish(entry("other group", {
          [ProcessManagerLogAnnotationKeys.groupId]: "@test/OtherGroup",
          [ProcessManagerLogAnnotationKeys.processId]: `${groupId}/OtherProcess`,
        }));

        const processLogs = yield* client.stream({
          follow: false,
          preludeLines: 10,
          scope: {
            _tag: "process",
            groupId,
            processId,
          },
        }).pipe(Stream.runCollect);

        assert.deepStrictEqual(
          processLogs.map((item) => item.message),
          ["process log"],
        );
      }).pipe(
        Effect.provide(relayOnlyLayer),
      ),
    ),
  );
});
