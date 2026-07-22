import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as QueueHyperlink from "../src/QueueHyperlink";
import * as CustomQueueHyperlink from "../src/CustomQueueHyperlink";

const Job = Schema.Struct({ id: Schema.String });
const Summary = Schema.Struct({ words: Schema.Number });
const WorkerErr = Schema.TaggedStruct("WorkerError", { reason: Schema.String });

describe("QueueHyperlink.Tag wire schemas (payload / success / error)", () => {
  it("payload only → nothing stamped", () => {
    class Q extends QueueHyperlink.Tag<Q>()("@app/Q1", Job) {}
    expect(QueueHyperlink.successOf(Q)).toBeUndefined();
    expect(QueueHyperlink.errorOf(Q)).toBeUndefined();
  });

  it("positional success → success stamped, error undefined", () => {
    class Q extends QueueHyperlink.Tag<Q>()("@app/Q2", Job, Summary) {}
    expect(QueueHyperlink.successOf(Q)).toBe(Summary);
    expect(QueueHyperlink.errorOf(Q)).toBeUndefined();
  });

  it("positional success + error → both stamped", () => {
    class Q extends QueueHyperlink.Tag<Q>()("@app/Q3", Job, Summary, WorkerErr) {}
    expect(QueueHyperlink.successOf(Q)).toBe(Summary);
    expect(QueueHyperlink.errorOf(Q)).toBe(WorkerErr);
  });

  it("config object → both stamped", () => {
    class Q extends QueueHyperlink.Tag<Q>()("@app/Q4", {
      payload: Job,
      success: Summary,
      error: WorkerErr,
    }) {}
    expect(QueueHyperlink.successOf(Q)).toBe(Summary);
    expect(QueueHyperlink.errorOf(Q)).toBe(WorkerErr);
  });

  it("config object with only payload → nothing stamped", () => {
    class Q extends QueueHyperlink.Tag<Q>()("@app/Q4b", { payload: Job }) {}
    expect(QueueHyperlink.successOf(Q)).toBeUndefined();
    expect(QueueHyperlink.errorOf(Q)).toBeUndefined();
  });

  it("legacy positional options { description } → not mistaken for success", () => {
    class Q extends QueueHyperlink.Tag<Q>()("@app/Q5", Job, {
      description: "queue five",
    }) {}
    expect(QueueHyperlink.successOf(Q)).toBeUndefined();
    expect(QueueHyperlink.errorOf(Q)).toBeUndefined();
  });

  it("readers are safe on non-tags", () => {
    expect(QueueHyperlink.successOf({})).toBeUndefined();
    expect(QueueHyperlink.successOf(null)).toBeUndefined();
    expect(QueueHyperlink.successOf(undefined)).toBeUndefined();
    expect(QueueHyperlink.errorOf(42)).toBeUndefined();
    expect(QueueHyperlink.successOf({ [Symbol.for("hyperlink-ts/Queue/success")]: "nope" })).toBeUndefined();
  });
});

describe("CustomQueueHyperlink.Tag wire schemas (config object only)", () => {
  it("optional success / error stamped like QueueHyperlink", () => {
    class Q extends CustomQueueHyperlink.Tag<Q>()("@app/CQR", {
      payload: Job,
      levelCount: 2,
      success: Summary,
      error: WorkerErr,
    }) {}
    expect(QueueHyperlink.successOf(Q)).toBe(Summary);
    expect(QueueHyperlink.errorOf(Q)).toBe(WorkerErr);
  });
});
