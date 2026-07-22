import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as WorkPool from "../src/WorkPool";

const Job = Schema.Struct({ id: Schema.String });
const Summary = Schema.Struct({ words: Schema.Number });
const WorkerErr = Schema.TaggedStruct("WorkerError", { reason: Schema.String });

describe("WorkPool.Tag wire schemas (payload / success / error)", () => {
  it("payload only → nothing stamped", () => {
    class Q extends WorkPool.Tag<Q>()("@app/Q1", Job) {}
    expect(WorkPool.successOf(Q)).toBeUndefined();
    expect(WorkPool.errorOf(Q)).toBeUndefined();
  });

  it("positional success → success stamped, error undefined", () => {
    class Q extends WorkPool.Tag<Q>()("@app/Q2", Job, Summary) {}
    expect(WorkPool.successOf(Q)).toBe(Summary);
    expect(WorkPool.errorOf(Q)).toBeUndefined();
  });

  it("positional success + error → both stamped", () => {
    class Q extends WorkPool.Tag<Q>()("@app/Q3", Job, Summary, WorkerErr) {}
    expect(WorkPool.successOf(Q)).toBe(Summary);
    expect(WorkPool.errorOf(Q)).toBe(WorkerErr);
  });

  it("config object → both stamped", () => {
    class Q extends WorkPool.Tag<Q>()("@app/Q4", {
      payload: Job,
      success: Summary,
      error: WorkerErr,
    }) {}
    expect(WorkPool.successOf(Q)).toBe(Summary);
    expect(WorkPool.errorOf(Q)).toBe(WorkerErr);
  });

  it("config object with only payload → nothing stamped", () => {
    class Q extends WorkPool.Tag<Q>()("@app/Q4b", { payload: Job }) {}
    expect(WorkPool.successOf(Q)).toBeUndefined();
    expect(WorkPool.errorOf(Q)).toBeUndefined();
  });

  it("legacy positional options { description } → not mistaken for success", () => {
    class Q extends WorkPool.Tag<Q>()("@app/Q5", Job, {
      description: "queue five",
    }) {}
    expect(WorkPool.successOf(Q)).toBeUndefined();
    expect(WorkPool.errorOf(Q)).toBeUndefined();
  });

  it("readers are safe on non-tags", () => {
    expect(WorkPool.successOf({})).toBeUndefined();
    expect(WorkPool.successOf(null)).toBeUndefined();
    expect(WorkPool.successOf(undefined)).toBeUndefined();
    expect(WorkPool.errorOf(42)).toBeUndefined();
    expect(WorkPool.successOf({ [Symbol.for("hyperlink-ts/Queue/success")]: "nope" })).toBeUndefined();
  });
});

describe("WorkPool.priority wire schemas (config object only)", () => {
  it("optional success / error stamped like WorkPool", () => {
    class Q extends WorkPool.priority<Q>()("@app/CQR", {
      payload: Job,
      levelCount: 2,
      success: Summary,
      error: WorkerErr,
    }) {}
    expect(WorkPool.successOf(Q)).toBe(Summary);
    expect(WorkPool.errorOf(Q)).toBe(WorkerErr);
  });
});
