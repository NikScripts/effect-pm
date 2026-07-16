import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Model from "../../src/docgen/Model.js";

const sample = {
  entry: "Layer",
  name: "layer",
  qualifiedName: "Layer.layer",
  url: "/api/effect/Layer/layer",
  kind: "const",
  signatures: [],
  sourceText: "export const layer = ...",
  summary: "Constructs a layer.",
  rawComment: "/** Constructs a layer. */",
  tags: [{ name: "since", text: "4.0.0" }],
  linkTargets: [],
  docLinks: {},
  source: { file: "repos/effect/packages/effect/src/Layer.ts", line: 54 },
};

describe("Model", () => {
  it("decodes a symbol (Schema is the SSOT)", () => {
    const decoded = Schema.decodeUnknownSync(Model.Symbol)(sample);
    expect(decoded.qualifiedName).toBe("Layer.layer");
    expect(decoded.tags).toStrictEqual([{ name: "since", text: "4.0.0" }]);
    expect(decoded.source.line).toBe(54);
    expect(decoded.typeText).toBeUndefined(); // optional, absent
  });

  it("round-trips JSON without drift", () => {
    const decoded = Schema.decodeUnknownSync(Model.Symbol)(sample);
    const encoded = Schema.encodeSync(Model.Symbol)(decoded);
    expect(encoded).toStrictEqual(sample);
  });

  it("rejects a malformed symbol", () => {
    // source.line must be a number
    expect(() =>
      Schema.decodeUnknownSync(Model.Symbol)({
        ...sample,
        source: { file: "x", line: "nope" },
      })
    ).toThrow();
    // missing required fields
    expect(() => Schema.decodeUnknownSync(Model.Symbol)({ entry: "x" })).toThrow();
  });
});
