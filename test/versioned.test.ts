import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema, SchemaTransformation } from "effect";
import * as Versioned from "../src/Versioned";

class JobV1 extends Schema.Class<JobV1>("jobs/payload@1")({
  id: Schema.String,
  note: Schema.String,
}) {}

class JobV2 extends Schema.Class<JobV2>("jobs/payload@2")({
  id: Schema.String,
  note: Schema.String,
  priority: Schema.Number,
}) {}

class JobV3 extends Schema.Class<JobV3>("jobs/payload@3")({
  id: Schema.String,
  body: Schema.Struct({
    note: Schema.String,
    priority: Schema.Number,
  }),
}) {}

const toV2 = SchemaTransformation.transform({
  decode: (j: JobV1): JobV2 => new JobV2({ ...j, priority: 0 }),
  encode: ({ priority: _p, ...j }: JobV2): JobV1 => new JobV1(j),
});

const toV3 = SchemaTransformation.transform({
  decode: (j: JobV2): JobV3 =>
    new JobV3({ id: j.id, body: { note: j.note, priority: j.priority } }),
  encode: (j: JobV3): JobV2 =>
    new JobV2({ id: j.id, note: j.body.note, priority: j.body.priority }),
});

const Job = Versioned.make(JobV1).migrate(JobV2, toV2).migrate(JobV3, toV3);

describe("Versioned", () => {
  it("schemaVersion uses Class.identifier for tips and carriers", () => {
    expect(Versioned.schemaVersion(JobV1)).toBe("jobs/payload@1");
    expect(Versioned.schemaVersion(JobV3)).toBe("jobs/payload@3");
    expect(Versioned.schemaVersion(Job)).toBe("jobs/payload@3");
    expect(Versioned.isVersioned(Job)).toBe(true);
    expect(Versioned.isVersioned(JobV3)).toBe(false);
  });

  it.effect("decodeFromVersion upcasts v1 → tip v3", () =>
    Effect.gen(function* () {
      const tip = yield* Versioned.decodeFromVersion(Job, "jobs/payload@1", {
        id: "1",
        note: "hi",
      });
      expect(tip).toEqual(
        new JobV3({ id: "1", body: { note: "hi", priority: 0 } }),
      );
    }),
  );

  it.effect("encodeToVersion downcasts tip → v1", () =>
    Effect.gen(function* () {
      const encoded = yield* Versioned.encodeToVersion(
        Job,
        "jobs/payload@1",
        new JobV3({ id: "1", body: { note: "hi", priority: 2 } }),
      );
      expect(encoded).toEqual({ id: "1", note: "hi" });
    }),
  );

  it.effect("missing tip id → MigrationPathMissing", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Versioned.decodeFromVersion(Job, "jobs/payload@99", { id: "1" }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause) as { readonly _tag?: string };
        expect(err._tag).toBe("MigrationPathMissing");
      }
    }),
  );

  it.effect("wireSchema accepts older tip shapes", () =>
    Effect.gen(function* () {
      const wire = Versioned.wireSchema(Job);
      const decoded = Schema.decodeUnknownExit(
        wire as Schema.Codec<unknown, unknown>,
      )({
        id: "1",
        note: "hi",
      });
      expect(Exit.isSuccess(decoded)).toBe(true);
      if (Exit.isSuccess(decoded)) {
        expect(decoded.value).toEqual(
          new JobV3({ id: "1", body: { note: "hi", priority: 0 } }),
        );
      }
    }),
  );
});
