import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { buildLogQuery, LogQueryError } from "../src/internal/manager/logQuery";
import { testBillingNodeKey, testSyncProcessKey } from "./fixtures/logKeys";

describe("logQuery", () => {
  it("builds an open query with defaults when no filters are set", () =>
    Effect.gen(function* () {
      const query = yield* buildLogQuery({
        scope: { _tag: "all" },
        from: Option.none(),
        to: Option.none(),
        after: Option.none(),
        before: Option.none(),
        limit: 100,
        sort: "desc",
      });
      assert.strictEqual(query.limit, 100);
      assert.strictEqual(query.sort, "desc");
      assert.strictEqual(query.groupId, undefined);
      assert.strictEqual(query.from, undefined);
      assert.strictEqual(query.to, undefined);
    }));

  it("rejects an inverted date range", () =>
    Effect.gen(function* () {
      const result = yield* buildLogQuery({
        scope: { _tag: "all" },
        from: Option.some("2026-05-22T20:00:00.000Z"),
        to: Option.some("2026-05-22T19:00:00.000Z"),
        after: Option.none(),
        before: Option.none(),
        limit: 50,
        sort: "asc",
      }).pipe(Effect.flip);
      assert.instanceOf(result, LogQueryError);
    }));

  it("builds a process-scoped query", () =>
    Effect.gen(function* () {
      const query = yield* buildLogQuery({
        scope: {
          _tag: "process",
          groupId: testBillingNodeKey,
          key: testSyncProcessKey,
        },
        from: Option.none(),
        to: Option.none(),
        after: Option.none(),
        before: Option.none(),
        limit: 10,
        sort: "desc",
      });
      assert.strictEqual(query.key, testSyncProcessKey);
      assert.strictEqual(query.groupId, testBillingNodeKey);
    }));
});
