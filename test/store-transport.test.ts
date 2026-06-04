import { RpcServer } from "effect/unstable/rpc";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Queue, Stream } from "effect";
import { RunResourceStore, storeTransport, ProcessStore } from "../src";
import { RuntimeStorage } from "../src/RuntimeStorage";
import type { StoreClientTransport } from "../src/storeTransport";
import type { ExitEncoded } from "../src/StoreMessage";

describe("storeTransport", () => {
  it.live(
    "serverLayer + RpcServer.Protocol round-trips RunResourceStore.facts",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = ProcessStore.registry([RunResourceStore]);

          const responseQueue = yield* Queue.unbounded<unknown>();
          let bridgeWrite:
            | ((cid: number, data: import("effect/unstable/rpc").RpcMessage.FromClientEncoded) => Effect.Effect<void>)
            | undefined;

          const protocol = yield* RpcServer.Protocol.make((w) =>
            Effect.scoped(
              Effect.gen(function* () {
                const disconnects = yield* Queue.unbounded<number>();
                bridgeWrite = w;
                return {
                  disconnects,
                  send: (_cid, r) =>
                    Effect.flatMap(Queue.offer(responseQueue, r), () => Effect.void),
                  end: () => Effect.void,
                  clientIds: Effect.succeed(new Set<number>([0])),
                  initialMessage: Effect.succeedNone,
                  supportsAck: true,
                  supportsTransferables: false,
                  supportsSpanPropagation: false,
                };
              }),
            ),
          );

          const protocolLayer = Layer.succeed(RpcServer.Protocol, protocol);
          const composedLayer = storeTransport
            .serverLayer(registry)
            .pipe(
              Layer.provide(protocolLayer),
              Layer.provide(RuntimeStorage.layer),
            );

          const pollResponse = (rid: string): Effect.Effect<
            ExitEncoded,
            never
          > =>
            Queue.take(responseQueue).pipe(
              Effect.flatMap((msg) => {
                const m = msg as unknown as {
                  readonly _tag: string;
                  readonly requestId?: string;
                  readonly exit?: ExitEncoded;
                  readonly defect?: unknown;
                };
                if (m._tag === "Exit" && m.requestId === rid && m.exit !== undefined) {
                  return Effect.succeed(m.exit);
                }
                if (m._tag === "Defect") {
                  return Effect.succeed({
                    _tag: "Failure",
                    cause: [{ _tag: "Die", defect: m.defect }],
                  } as const);
                }
                return pollResponse(rid);
              }),
            );

          const transport: StoreClientTransport = {
            send: (req) =>
              Effect.gen(function* () {
                const rid = String(BigInt(Math.floor(Math.random() * 1000000)));
                yield* bridgeWrite!(0, {
                  _tag: "Request",
                  id: rid,
                  tag: req.tag,
                  payload: req.payload,
                  headers: req.headers,
                } as import("effect/unstable/rpc").RpcMessage.FromClientEncoded);
                return yield* pollResponse(rid);
              }),
            sendStream: () => Stream.empty,
          };

          const facts = yield* Effect.gen(function* () {
            const client = storeTransport.makeClient(registry, transport);
            const qc = storeTransport.toProcessStoreQueryClient(client);
            return yield* qc.query("RunResource", "facts", {
              resourceId: "test",
              types: [],
            });
          }).pipe(Effect.provide(composedLayer));

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
