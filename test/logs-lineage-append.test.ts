/**
 * Logs.withScope — append-only lineage reducer (persist a path, not a singleton replace).
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Stream } from "effect";
import { CurrentLogAnnotations } from "effect/References";
import * as LogEntry from "../src/LogEntry";
import { LogAnnotationKeys } from "../src/LogContext";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";

class Parent extends Process.Tag<Parent>()("test/lineage/Parent") {}
class Child extends Process.Tag<Child>()("test/lineage/Child") {}

const parseLineage = (raw: unknown): ReadonlyArray<string> => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
};

const readLineage = Effect.map(CurrentLogAnnotations, (ann) =>
  parseLineage(ann[LogAnnotationKeys.lineage]),
);

describe("Logs.withScope — lineage append", () => {
  it.effect("nested scopes combine into a path (parent then child)", () =>
    Effect.gen(function* () {
      const lineage = yield* readLineage.pipe(
        Logs.withScope(Child),
        Logs.withScope(Parent),
      );
      expect(lineage).toEqual([Parent.key, Child.key]);
    }),
  );

  it.effect("single scope stamps a one-segment path", () =>
    Effect.gen(function* () {
      const lineage = yield* readLineage.pipe(Logs.withScope(Parent));
      expect(lineage).toEqual([Parent.key]);
    }),
  );

  it.effect("re-entering the same key is idempotent (no duplicate leaf)", () =>
    Effect.gen(function* () {
      const lineage = yield* readLineage.pipe(
        Logs.withScope(Parent),
        Logs.withScope(Parent),
      );
      expect(lineage).toEqual([Parent.key]);
    }),
  );

  it.effect("nested fiber path has root parent and leaf child", () =>
    Effect.gen(function* () {
      const segments = yield* readLineage.pipe(
        Logs.withScope(Child),
        Logs.withScope(Parent),
      );
      expect(segments).toEqual([Parent.key, Child.key]);
      expect(segments[0]).toBe(Parent.key);
      expect(segments[segments.length - 1]).toBe(Child.key);
    }),
  );

  it("LogEntry predicates honor a multi-segment lineage annotation", () => {
    const entry: LogEntry.LogEntry = {
      date: "1970-01-01T00:00:00.000Z",
      level: "Info",
      message: "x",
      annotations: {
        [LogAnnotationKeys.lineage]: `["${Parent.key}","${Child.key}"]`,
      },
      spans: [],
    };
    expect(LogEntry.lineage(entry)).toEqual([Parent.key, Child.key]);
    expect(LogEntry.atRoot(Parent.key)(entry)).toBe(true);
    expect(LogEntry.atLeaf(Child.key)(entry)).toBe(true);
    expect(LogEntry.hasKey(Parent.key)(entry)).toBe(true);
    expect(LogEntry.hasKey(Child.key)(entry)).toBe(true);
    expect(LogEntry.atRoot(Child.key)(entry)).toBe(false);
  });

  it.live("capture logger stamps the appended lineage on a published line", () =>
    Effect.gen(function* () {
      const collected = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(Logs.stream, 1)),
      );
      yield* Effect.logInfo("lineage-path").pipe(
        Logs.withScope(Child),
        Logs.withScope(Parent),
      );
      const [entry] = Array.from(yield* Fiber.join(collected));
      expect(entry?.message).toBe("lineage-path");
      expect(LogEntry.lineage(entry!)).toEqual([Parent.key, Child.key]);
      expect(LogEntry.atRoot(Parent.key)(entry!)).toBe(true);
      expect(LogEntry.atLeaf(Child.key)(entry!)).toBe(true);
    }).pipe(Effect.provide(Logs.layer), Effect.scoped),
  );
});
