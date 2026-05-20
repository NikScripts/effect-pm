import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import type { RuntimeRecord } from "../src/RuntimeStorage";
import {
  decodeRuntimeRecordRow,
  encodeRuntimeRecordParamsEffect,
  parseIndexNamesColumn,
  parseJsonColumn,
} from "../src/storage/sqlite/codec";

const dt = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

describe("SQLite codec helpers", () => {
  it.effect("parseJsonColumn returns undefined for invalid JSON", () =>
    Effect.sync(() => {
      expect(parseJsonColumn("{")).toBeUndefined();
      expect(parseJsonColumn("null")).toEqual(null);
      expect(parseJsonColumn("1")).toBe(1);
      expect(parseJsonColumn('{"a":1}')).toEqual({ a: 1 });
      expect(parseJsonColumn("[1,2]")).toEqual([1, 2]);
      expect(parseJsonColumn("[1, function() {}]")).toBeUndefined();
    }),
  );

  it.effect("parseIndexNamesColumn rejects non-string arrays", () =>
    Effect.sync(() => {
      expect(parseIndexNamesColumn("[1,2]")).toBeUndefined();
      expect(parseIndexNamesColumn('["x","y"]')).toEqual(["x", "y"]);
    }),
  );

  it.effect("decodeRuntimeRecordRow maps snake_case columns", () =>
    Effect.sync(() => {
      const row = decodeRuntimeRecordRow({
        id: "x",
        type: "t",
        occurred_at_ms: 1_700_000_000_000,
        created_at_ms: 1_700_000_000_001,
        run_id: "run",
        process_type: "pt",
        process_id: "pid",
        subject_type: null,
        subject_id: null,
        key: null,
        index_a: null,
        index_b: null,
        index_c: null,
        index_d: null,
        index_e: null,
        index_f: null,
        index_g: null,
        index_h: null,
        index_names_json: null,
        payload_json: null,
        attributes_json: null,
        readonly_int: 0,
      });
      expect(row.id).toBe("x");
      expect(row.readonly).toBeUndefined();
      expect(DateTime.toEpochMillis(row.occurredAt)).toBe(1_700_000_000_000);
    }),
  );

  it.effect("decodeRuntimeRecordRow rejects corrupt adapter-owned rows", () =>
    Effect.sync(() => {
      expect(() =>
        decodeRuntimeRecordRow({
          id: "x",
          type: "t",
          occurred_at_ms: "not-a-number",
          created_at_ms: 0,
          run_id: "r",
          process_type: "p",
          process_id: "q",
          subject_type: null,
          subject_id: null,
          key: null,
          index_a: null,
          index_b: null,
          index_c: null,
          index_d: null,
          index_e: null,
          index_f: null,
          index_g: null,
          index_h: null,
          index_names_json: null,
          payload_json: null,
          attributes_json: null,
          readonly_int: 0,
        }),
      ).toThrow("occurred_at_ms");
    }),
  );

  it.effect("encodeRuntimeRecordParamsEffect JSON-encodes optional columns", () =>
    Effect.gen(function* () {
      const record: RuntimeRecord = {
        id: "id",
        type: "t",
        occurredAt: dt("2026-01-01T00:00:00.000Z"),
        createdAt: dt("2026-01-01T00:00:01.000Z"),
        runId: "run",
        processType: "pt",
        processId: "pid",
        indexNames: ["x"],
        payload: { n: 1 },
        attributes: [true],
      };
      const p = yield* encodeRuntimeRecordParamsEffect(record);
      expect(p.index_names_json).toBe('["x"]');
      expect(p.payload_json).toBe('{"n":1}');
      expect(p.attributes_json).toBe("[true]");
    }),
  );

  it.effect("decodeRuntimeRecordRow treats readonly_int 1 as readonly", () =>
    Effect.sync(() => {
      const row = decodeRuntimeRecordRow({
        id: "x",
        type: "t",
        occurred_at_ms: 0,
        created_at_ms: 0,
        run_id: "r",
        process_type: "p",
        process_id: "q",
        subject_type: null,
        subject_id: null,
        key: null,
        index_a: null,
        index_b: null,
        index_c: null,
        index_d: null,
        index_e: null,
        index_f: null,
        index_g: null,
        index_h: null,
        index_names_json: null,
        payload_json: null,
        attributes_json: null,
        readonly_int: 1,
      });
      expect(row.readonly).toBe(true);
    }),
  );
});
