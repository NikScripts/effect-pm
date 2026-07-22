import { describe, expect, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Duration, Effect, FileSystem, Layer, Path } from "effect";
import { TestClock } from "effect/testing";
import { LogAnnotationKeys } from "../src/LogContext";
import * as LogEntry from "../src/LogEntry";
import type { LogEntry as LogEntryT } from "../src/LogEntry";
import * as Logs from "../src/Logs";
import * as Process from "../src/Process";
import * as Store from "../src/Store";
import { durableTailPolicy, meetsStoreLevel } from "../src/internal/logs/durableTailPolicy";
import { lineIdFromEntry, makeLineIdClaim } from "../src/internal/logs/lineId";

const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

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

  it.effect("lineId claim seed rejects already-durable ids", () =>
    Effect.gen(function* () {
      const id = lineIdFromEntry(entry("seeded", { lineId: "S1" }));
      const claim = yield* makeLineIdClaim(ProcA.key, { seed: [id] });
      expect(yield* claim(id)).toBe(false);
      const other = lineIdFromEntry(entry("fresh", { lineId: "S2" }));
      expect(yield* claim(other)).toBe(true);
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

      const a = yield* Logs.byHyperlink(ProcA.key);
      const b = yield* Logs.byHyperlink(ProcB.key);
      expect(a.map((row) => row.message)).toEqual(["a"]);
      expect(a.every(LogEntry.hasKey(ProcA.key))).toBe(true);
      // Warn floor on ProcB drops Info
      expect(b).toEqual([]);
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  );

  it.effect("memo appends once for the same lineId", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      yield* TestClock.adjust(Duration.millis(1));
      const duplicated = entry("dup", { lineage: [ProcA.key], lineId: "same" });
      yield* relay.publish(duplicated);
      yield* relay.publish(duplicated);
      yield* TestClock.adjust(Duration.millis(300));

      const rows = yield* Logs.byHyperlink(ProcA.key);
      expect(rows.filter((row) => row.message === "dup")).toHaveLength(1);
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  );

  it.effect("Warn floor drops Info on that registration", () =>
    Effect.gen(function* () {
      const relay = yield* Logs.Relay;
      yield* TestClock.adjust(Duration.millis(1));
      yield* relay.publish(entry("info", { lineage: [ProcB.key], level: "Info" }));
      yield* relay.publish(entry("warn", { lineage: [ProcB.key], level: "Warn" }));
      yield* TestClock.adjust(Duration.millis(300));

      const rows = yield* Logs.byHyperlink(ProcB.key);
      expect(rows.map((row) => row.message)).toEqual(["warn"]);
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  );

  it.effect("AppStore.layerMemory includes Logs capture + empty log until publish", () =>
    Effect.gen(function* () {
      expect(yield* Logs.byHyperlink(ProcA.key)).toEqual([]);
      yield* Effect.logInfo("captured-by-store-layer");
      yield* TestClock.adjust(Duration.millis(300));
      const rows = yield* Logs.byHyperlink(ProcA.key);
      // No lineage scope on bare Effect.log — resource match drops it.
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
    }).pipe(Effect.provide(AppStore.layerMemory), Effect.scoped),
  );

  it.live("SQLite rematerialize does not re-append a seeded lineId", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectory();
      const filename = path.join(directory, "lineid-memo.sqlite");

      yield* Effect.gen(function* () {
        yield* Effect.logInfo("persist-once").pipe(Logs.withScope(ProcA));
        yield* Effect.sleep(Duration.millis(800));
        expect(yield* Logs.byHyperlink(ProcA.key)).toHaveLength(1);
      }).pipe(Effect.provide(AppStore.layer({ filename })), Effect.scoped);

      const prior = yield* Logs.byHyperlink(ProcA.key).pipe(
        Effect.provide(AppStore.layer({ filename })),
        Effect.scoped,
      );
      const lineId = prior[0]?.annotations[LogAnnotationKeys.lineId];
      expect(lineId).toBeDefined();

      // Rematerialize: re-log with the same lineId annotation (capture path). Seeded
      // claim keeps count at 1; a fresh message proves the tail is alive.
      yield* Effect.gen(function* () {
        const again = Effect.logInfo("persist-once").pipe(
          Effect.annotateLogs({ [LogAnnotationKeys.lineId]: lineId! }),
          Logs.withScope(ProcA),
        );
        yield* again;
        yield* again;
        yield* Effect.logInfo("fresh-after-rematerialize").pipe(
          Logs.withScope(ProcA),
        );
        yield* Effect.sleep(Duration.millis(1000));
        const after = yield* Logs.byHyperlink(ProcA.key);
        expect(
          after.filter((row) => row.message === "persist-once"),
        ).toHaveLength(1);
        expect(
          after.filter((row) => row.message === "fresh-after-rematerialize"),
        ).toHaveLength(1);
      }).pipe(Effect.provide(AppStore.layer({ filename })), Effect.scoped);
    }).pipe(Effect.provide(nodePlatform)),
  );
});
