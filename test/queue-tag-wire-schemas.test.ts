import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as QueueResource from "../src/QueueResource";

// Piece 1 of the queue store cutover: the `payload` / `success` / `error` triplet on the Tag.
// `payload` is required (the item schema); `success` / `error` are optional wire slots stamped for
// the engine + store to read as the tag SSOT. `successOf` / `errorOf` read them back.

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
    // a stamped-looking but non-schema value is rejected by the isSchema guard
    expect(QueueResource.successOf({ [Symbol.for("@nikscripts/effect-pm/Queue/success")]: "nope" })).toBeUndefined();
  });
});
