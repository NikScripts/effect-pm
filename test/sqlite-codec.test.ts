import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import {
  decodeRuntimeRecordRow,
  parseIndexNamesColumn,
  parseJsonColumn,
} from "../src/storage/sqlite/codec";

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
