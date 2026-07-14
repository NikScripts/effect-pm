import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { LogAnnotationKeys } from "../src/LogContext";
import * as LogEntry from "../src/LogEntry";
import type { LogEntry as LogEntryT } from "../src/LogEntry";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { durableTailPolicy, meetsStoreLevel } from "../src/internal/logs/durableTailPolicy";
import { lineIdFromEntry, makeLineIdClaim } from "../src/internal/logs/lineId";

class ProcA extends Process.Tag<ProcA>()("test/logs-tail/A") {}
class ProcB extends Process.Tag<ProcB>()("test/logs-tail/B") {}

class AppStore extends Store.Service<AppStore>("@test/logs-durable-tail/Store")(
  Process.store(ProcA),
  Process.store(ProcB).pipe(Store.logLevelWarn),
) {}

const entry = (
  message: string,
  options?: {
    readonly level?: LogEntryT["level"];
    readonly lineage?: ReadonlyArray<string>;
    readonly lineId?: string;
  },
): LogEntryT => ({
  date: "1970-01-01T00:00:00.000Z",
  level: options?.level ?? "Info",
  message,
  annotations: {
    ...(options?.lineage === undefined
      ? {}
      : { [LogAnnotationKeys.lineage]: JSON.stringify(options.lineage) }),
    ...(options?.lineId === undefined
      ? {}
      : { [LogAnnotationKeys.lineId]: options.lineId }),
  },
  spans: [],
});

/** LogRelay must be a provide parent so tails see it at store layer build. */
const env = AppStore.layerMemory.pipe(Layer.provideMerge(Logs.layer));

describe("durable log store tail", () => {
  it("meetsStoreLevel gates on Effect LogLevel order", () => {
    expect(meetsStoreLevel("All")(entry("x", { level: "Trace" }))).toBe(true);
    expect(meetsStoreLevel("None")(entry("x", { level: "Fatal" }))).toBe(false);
    expect(meetsStoreLevel("Warn")(entry("x", { level: "Info" }))).toBe(false);
    expect(meetsStoreLevel("Warn")(entry("x", { level: "Warn" }))).toBe(true);
    expect(meetsStoreLevel("Warn")(entry("x", { level: "Error" }))).toBe(true);
  });

  it("durableTailPolicy is level ∧ match", () => {
    const policy = durableTailPolicy({
      storeLevel: "Info",
      match: LogEntry.hasKey(ProcA.key),
    });
    expect(policy(entry("a", { lineage: [ProcA.key], level: "Info" }))).toBe(true);
    expect(policy(entry("b", { lineage: [ProcB.key], level: "Info" }))).toBe(false);
    expect(policy(entry("c", { lineage: [ProcA.key], level: "Debug" }))).toBe(false);
  });

  it.effect("lineId claim memos once per scope set", () =>
    Effect.gen(function* () {
      const claim = yield* makeLineIdClaim(ProcA.key);
      const id = lineIdFromEntry(entry("once", { lineId: "L1" }));
      expect(yield* claim(id)).toBe(true);
      expect(yield* claim(id)).toBe(false);
    }),
  );

  it.effect("resource tail is lineage-scoped", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      // Let forked PubSub subscribers attach before publish.
      yield* TestClock.adjust(Duration.millis(1));
      yield* relay.publish(entry("a", { lineage: [ProcA.key] }));
      yield* relay.publish(entry("b", { lineage: [ProcB.key] }));
      yield* TestClock.adjust(Duration.millis(300));

      const aHandle = yield* AppStore.at(ProcA);
      const bHandle = yield* AppStore.at(ProcB);
      const a = yield* aHandle.log.read();
      const b = yield* bHandle.log.read();
      expect(a.map((row) => row.message)).toEqual(["a"]);
      expect(a.every(LogEntry.hasKey(ProcA.key))).toBe(true);
      // Warn floor on ProcB drops Info
      expect(b).toEqual([]);
    }).pipe(Effect.provide(env), Effect.scoped),
  );

  it.effect("memo appends once for the same lineId", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      yield* TestClock.adjust(Duration.millis(1));
      const duplicated = entry("dup", { lineage: [ProcA.key], lineId: "same" });
      yield* relay.publish(duplicated);
      yield* relay.publish(duplicated);
      yield* TestClock.adjust(Duration.millis(300));

      const handle = yield* AppStore.at(ProcA);
      const rows = yield* handle.log.read();
      expect(rows.filter((row) => row.message === "dup")).toHaveLength(1);
    }).pipe(Effect.provide(env), Effect.scoped),
  );

  it.effect("Warn floor drops Info on that registration", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      yield* TestClock.adjust(Duration.millis(1));
      yield* relay.publish(entry("info", { lineage: [ProcB.key], level: "Info" }));
      yield* relay.publish(entry("warn", { lineage: [ProcB.key], level: "Warn" }));
      yield* TestClock.adjust(Duration.millis(300));

      const handle = yield* AppStore.at(ProcB);
      const rows = yield* handle.log.read();
      expect(rows.map((row) => row.message)).toEqual(["warn"]);
    }).pipe(Effect.provide(env), Effect.scoped),
  );

  it.effect("store builds with empty log.read when LogRelay is absent", () =>
    Effect.gen(function* () {
      const handle = yield* AppStore.at(ProcA);
      const rows = yield* handle.log.read();
      expect(rows).toEqual([]);
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  );

  it.effect("relay publish stamps lineId annotation", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      yield* relay.publish(entry("stamped", { lineage: [ProcA.key] }));
      const snap = yield* relay.snapshot;
      const last = snap[snap.length - 1];
      expect(last?.annotations[LogAnnotationKeys.lineId]).toBeDefined();
    }).pipe(Effect.provide(Logs.layer), Effect.scoped),
  );
});
