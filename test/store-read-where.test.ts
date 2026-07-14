import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Store from "../src/Store";
import { matchWhere } from "../src/internal/store/where";

const readingSchema = Schema.Struct({
  value: Schema.Number,
  meta: Schema.Struct({
    source: Schema.String,
    tags: Schema.Array(Schema.String),
  }),
});

const contract = Store.contract({
  readings: Store.shape(readingSchema),
});

class ReadingsStore extends Store.Service<ReadingsStore>("@test/ReadingsStore")(
  Store.scoped("readings", contract),
) {}

describe("matchWhere (RQB)", () => {
  const row = {
    value: 72,
    meta: { source: "probe", tags: ["a", "b"] },
  };

  it("shorthand equality", () => {
    expect(matchWhere(row, { value: 72 })).toBe(true);
    expect(matchWhere(row, { value: 1 })).toBe(false);
  });

  it("nested field + operators", () => {
    expect(matchWhere(row, { meta: { source: { eq: "probe" } } })).toBe(true);
    expect(matchWhere(row, { meta: { source: { like: "pr%" } } })).toBe(true);
    expect(matchWhere(row, { value: { gte: 70, lt: 80 } })).toBe(true);
    expect(matchWhere(row, { value: { in: [70, 72] } })).toBe(true);
  });

  it("AND / OR / NOT", () => {
    expect(
      matchWhere(row, {
        AND: [{ value: { gte: 70 } }, { meta: { source: "probe" } }],
      }),
    ).toBe(true);
    expect(
      matchWhere(row, {
        OR: [{ value: 1 }, { value: 72 }],
      }),
    ).toBe(true);
    expect(matchWhere(row, { NOT: { value: 72 } })).toBe(false);
  });

  it("array ops", () => {
    expect(matchWhere(row, { meta: { tags: { arrayContains: ["a"] } } })).toBe(true);
    expect(matchWhere(row, { meta: { tags: { arrayOverlaps: ["b", "z"] } } })).toBe(true);
  });
});

describe("Store.shape.read where", () => {
  it.effect("filters nested where before limit", () =>
    Effect.gen(function* () {
      const handle = yield* ReadingsStore;
      yield* handle.readings.append([
        { value: 1, meta: { source: "a", tags: [] } },
        { value: 72, meta: { source: "probe", tags: ["x"] } },
        { value: 80, meta: { source: "probe", tags: ["y"] } },
        { value: 90, meta: { source: "other", tags: [] } },
      ]);

      const rows = yield* handle.readings.read({
        limit: 1,
        where: {
          meta: { source: "probe" },
          value: { gte: 70 },
        },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.value).toBe(72);
    }).pipe(Effect.provide(ReadingsStore.layerMemory)),
  );
});
