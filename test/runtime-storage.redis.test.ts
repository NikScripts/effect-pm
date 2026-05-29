import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  makeInMemoryRedisSend,
  makeRuntimeStorage,
} from "../src/storage/redis";
import { describeRuntimeStorageContract, runtimeStorageRecord } from "./runtime-storage.conformance";

const inMemoryRedisStorage = Effect.gen(function* () {
  const send = makeInMemoryRedisSend();
  return yield* makeRuntimeStorage({ send });
});

describeRuntimeStorageContract("RedisRuntimeStorage contract", inMemoryRedisStorage);

describe("RedisRuntimeStorage", () => {
  it.live("isolates namespaces on separate send backends", () =>
    Effect.gen(function* () {
      const sendA = makeInMemoryRedisSend();
      const sendB = makeInMemoryRedisSend();
      const storageA = yield* makeRuntimeStorage({ send: sendA, namespace: "tenant-a" });
      const storageB = yield* makeRuntimeStorage({ send: sendB, namespace: "tenant-b" });

      yield* storageA.create(runtimeStorageRecord("only-a"));
      yield* storageB.create(runtimeStorageRecord("only-b"));

      const rowsA = yield* storageA.read();
      const rowsB = yield* storageB.read();

      expect(rowsA.map((row) => row.id)).toEqual(["only-a"]);
      expect(rowsB.map((row) => row.id)).toEqual(["only-b"]);
    }),
  );
});
