import { Effect, Schema } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import { QueueControlSpec } from "../src/QueueContract";
import { Resource, forwardClient, groupOf, specOf } from "../src/Resource";

// A queue family built from the control contract: many instances share the "queue" group.
const Queue = Resource.tagFor("queue", QueueControlSpec);
class Jobs extends Queue<Jobs>("@app/Jobs") {}
class Mail extends Queue<Mail>("@app/Mail") {}

// Minimal in-memory queue control impl (just enough state to assert the verbs round-trip).
const makeImpl = () => {
  let paused = false;
  let pending = 3;
  let done = 0;
  return {
    size: Effect.sync(() => pending),
    sizes: Effect.sync(() => ({ high: 0, normal: pending, low: 0 })),
    isEmpty: Effect.sync(() => pending === 0),
    completed: Effect.sync(() => done),
    start: Effect.void,
    pause: Effect.sync(() => {
      paused = true;
    }),
    resume: Effect.sync(() => {
      paused = false;
    }),
    shutdown: Effect.sync(() => {
      pending = 0;
    }),
    clear: Effect.sync(() => {
      const cleared = pending;
      pending = 0;
      done = 0;
      void paused;
      return cleared;
    }),
  };
};

it("drives a queue's control surface remotely, routed by instance id", () => {
  const jobsImpl = makeImpl();
  const mailImpl = makeImpl();

  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Queue));
    const jobs = forwardClient(rpc, specOf(Queue), Jobs.groupId, Jobs.id);
    const mail = forwardClient(rpc, specOf(Queue), Mail.groupId, Mail.id);

    // observation verbs round-trip
    expect(yield* jobs.size).toBe(3);
    expect(yield* jobs.sizes).toEqual({ high: 0, normal: 3, low: 0 });
    expect(yield* jobs.isEmpty).toBe(false);

    // control verbs route to the right instance
    yield* jobs.pause;
    yield* jobs.resume;
    expect(yield* jobs.clear).toBe(3); // Jobs drained
    expect(yield* jobs.size).toBe(0);
    expect(yield* mail.size).toBe(3); // Mail untouched — routing is per-instance
  }).pipe(
    Effect.provide(
      Resource.serverFamily(Queue, [
        [Jobs, jobsImpl],
        [Mail, mailImpl],
      ]),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// The control spec is the fixed-schema half; the data-plane (item-typed) verbs come later.
it("exposes the expected control verbs", () => {
  expect(Object.keys(QueueControlSpec).sort()).toEqual(
    [
      "clear",
      "completed",
      "isEmpty",
      "pause",
      "resume",
      "shutdown",
      "size",
      "sizes",
      "start",
    ].sort(),
  );
  // sanity: the spec entries are schemas/descriptors usable by the toolkit
  expect(Schema.isSchema(QueueControlSpec.size)).toBe(true);
});
