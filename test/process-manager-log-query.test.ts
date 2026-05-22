import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import {
  buildProcessManagerLogQuery,
  ProcessManagerLogQueryError,
  queryGroupLogs,
} from "../src/processManagerLogQuery.js";

describe("processManagerLogQuery", () => {
  it("builds an open query with defaults when no filters are set", () =>
    Effect.gen(function* () {
      const query = yield* buildProcessManagerLogQuery({
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
      const result = yield* buildProcessManagerLogQuery({
        from: Option.some("2026-05-22T20:00:00.000Z"),
        to: Option.some("2026-05-22T19:00:00.000Z"),
        after: Option.none(),
        before: Option.none(),
        limit: 50,
        sort: "asc",
      }).pipe(Effect.flip);
      assert.instanceOf(result, ProcessManagerLogQueryError);
    }));

  it("fails query execution until storage is wired", () =>
    Effect.gen(function* () {
      const query = yield* buildProcessManagerLogQuery({
        groupId: "workshop-group",
        from: Option.none(),
        to: Option.none(),
        after: Option.none(),
        before: Option.none(),
        limit: 10,
        sort: "desc",
      });
      const error = yield* queryGroupLogs(query).pipe(Effect.flip);
      assert.instanceOf(error, ProcessManagerLogQueryError);
      assert.match(error.reason, /storage is not configured/i);
    }));
});
