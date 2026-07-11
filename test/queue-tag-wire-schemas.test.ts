import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import * as CustomQueueResource from "../src/CustomQueueResource";

const Job = Schema.Struct({ id: Schema.String });
const Summary = Schema.Struct({ words: Schema.Number });
const WorkerErr = Schema.TaggedStruct("WorkerError", { reason: Schema.String });

describe("QueueResource.Tag wire schemas (payload / success / error)", () => {
  it("payload only → nothing stamped", () => {
    class Q extends QueueResource.Tag<Q>()("@app/Q1", Job) {}
    expect(QueueResource.successOf(Q)).toBeUndefined();
    expect(QueueResource.errorOf(Q)).toBeUndefined();
  });

  it("positional success → success stamped, error undefined", () => {
    class Q extends QueueResource.Tag<Q>()("@app/Q2", Job, Summary) {}
    expect(QueueResource.successOf(Q)).toBe(Summary);
    expect(QueueResource.errorOf(Q)).toBeUndefined();
  });

  it("positional success + error → both stamped", () => {
    class Q extends QueueResource.Tag<Q>()("@app/Q3", Job, Summary, WorkerErr) {}
    expect(QueueResource.successOf(Q)).toBe(Summary);
    expect(QueueResource.errorOf(Q)).toBe(WorkerErr);
  });

  it("config object → both stamped", () => {
    class Q extends QueueResource.Tag<Q>()("@app/Q4", {
      payload: Job,
      success: Summary,
      error: WorkerErr,
    }) {}
    expect(QueueResource.successOf(Q)).toBe(Summary);
    expect(QueueResource.errorOf(Q)).toBe(WorkerErr);
  });

  it("config object with only payload → nothing stamped", () => {
    class Q extends QueueResource.Tag<Q>()("@app/Q4b", { payload: Job }) {}
    expect(QueueResource.successOf(Q)).toBeUndefined();
    expect(QueueResource.errorOf(Q)).toBeUndefined();
  });

  it("legacy positional options { description } → not mistaken for success", () => {
    class Q extends QueueResource.Tag<Q>()("@app/Q5", Job, {
      description: "queue five",
    }) {}
    expect(QueueResource.successOf(Q)).toBeUndefined();
    expect(QueueResource.errorOf(Q)).toBeUndefined();
  });

  it("readers are safe on non-tags", () => {
    expect(QueueResource.successOf({})).toBeUndefined();
    expect(QueueResource.successOf(null)).toBeUndefined();
    expect(QueueResource.successOf(undefined)).toBeUndefined();
    expect(QueueResource.errorOf(42)).toBeUndefined();
    expect(QueueResource.successOf({ [Symbol.for("@nikscripts/effect-pm/Queue/success")]: "nope" })).toBeUndefined();
  });
});

describe("CustomQueueResource.Tag wire schemas (config object only)", () => {
  it("optional success / error stamped like QueueResource", () => {
    class Q extends CustomQueueResource.Tag<Q>()("@app/CQR", {
      payload: Job,
      levelCount: 2,
      success: Summary,
      error: WorkerErr,
    }) {}
    expect(QueueResource.successOf(Q)).toBe(Summary);
    expect(QueueResource.errorOf(Q)).toBe(WorkerErr);
  });
});
