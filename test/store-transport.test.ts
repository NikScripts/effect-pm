import { assert, describe, it } from "@effect/vitest";
import { Effect, Queue, Stream } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import { RunResourceStore, storeTransport, ProcessStore } from "../src";
import { RuntimeStorage } from "../src/RuntimeStorage";
import { makeNoStore } from "../src/internal/store/storeTransport";

describe("storeTransport", () => {
  it.live("round-trips RunResourceStore.facts query through store transport", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = ProcessStore.registry([RunResourceStore]);
        const responseQueue = yield* Queue.unbounded<any>();

        const server = yield* makeNoStore(registry, {
          onFromServer: (_cid, r) =>
            Effect.flatMap(Queue.offer(responseQueue, r), () => Effect.void),
          disableTracing: true,
          disableSpanPropagation: true,
        }).pipe(Effect.provide(RuntimeStorage.layer));

        const transport = {
          send: (req: {
            readonly tag: string;
            readonly payload: unknown;
            readonly headers: ReadonlyArray<[string, string]>;
          }) =>
            Effect.gen(function* () {
              const rid = String(
                BigInt(Math.floor(Math.random() * 1000000)),
              );
              yield* server.write(0, {
                _tag: "Request",
                id: rid,
                tag: req.tag,
                payload: req.payload,
                headers: req.headers,
              } as any);
              let exit: any;
              let tries = 0;
              while (exit === undefined) {
                const msg = yield* Queue.take(responseQueue);
                if (msg._tag === "Exit" && msg.requestId === rid) {
                  exit = msg.exit;
                } else if (msg._tag === "Defect") {
                  exit = { _tag: "Failure", cause: [{ _tag: "Die", defect: msg.defect }] };
                }
                if (++tries > 200) throw new Error("response not found");
              }
              return exit;
            }),
          sendStream: () => Stream.empty,
        };

        const client = storeTransport.makeClient(registry, transport as any);
        const qc = storeTransport.toProcessStoreQueryClient(client as any);

        const facts = yield* qc.query("RunResource", "facts", {
          resourceId: "test",
          types: [],
        });

        assert.deepStrictEqual(facts, []);
      }),
    ),
  );

  it.live("RpcServer.Protocol.make constructs a valid Protocol", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const protocol = yield* RpcServer.Protocol.make((_w) =>
          Effect.scoped(
            Effect.gen(function* () {
              const dq = yield* Queue.unbounded<number>();
              return {
                disconnects: dq,
                send: () => Effect.void,
                end: () => Effect.void,
                clientIds: Effect.succeed(new Set<number>()),
                initialMessage: Effect.succeedNone,
                supportsAck: true,
                supportsTransferables: false,
                supportsSpanPropagation: false,
              };
            }),
          ),
        );

        assert.ok(typeof protocol.run === "function");
        assert.ok(typeof protocol.send === "function");
        assert.ok(typeof protocol.end === "function");
        assert.strictEqual(protocol.supportsAck, true);

        const never = protocol.run(() => Effect.void);
        assert.ok(Effect.isEffect(never));
      }),
    ),
  );
});
