import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import {
  contractDescriptor,
  hashContract,
} from "../src/internal/contractHash";

class Probe extends Hyperlink.Tag<Probe>()("hash/Probe", {
  ping: Hyperlink.effectFn({ n: Schema.Number }, Schema.Number),
}) {}

describe("contractHash / hashContract", () => {
  it("is stable for the same Spec", () => {
    const a = Hyperlink.contractHash(Probe);
    const b = Hyperlink.contractHash(Probe);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("matches hashContract on the tag Spec", () => {
    const kind = Hyperlink.kindOf(Probe) ?? "hyperlink";
    expect(Hyperlink.contractHash(Probe)).toBe(
      hashContract(Probe.key, kind, Probe[Hyperlink.specSym]),
    );
  });

  it("changes when a method payload schema drifts", () => {
    const kind = Hyperlink.kindOf(Probe) ?? "hyperlink";
    const base = Probe[Hyperlink.specSym];
    const drifted = {
      ...base,
      ping: Hyperlink.effectFn({ n: Schema.String }, Schema.Number),
    };
    expect(hashContract(Probe.key, kind, base)).not.toBe(
      hashContract(Probe.key, kind, drifted),
    );
  });

  it("changes when a wire method is added", () => {
    const kind = Hyperlink.kindOf(Probe) ?? "hyperlink";
    const base = Probe[Hyperlink.specSym];
    const extra = {
      ...base,
      pong: Hyperlink.effect(Schema.Void),
    };
    expect(hashContract(Probe.key, kind, base)).not.toBe(
      hashContract(Probe.key, kind, extra),
    );
  });

  it("contractDescriptor is JSON-stable (sorted keys)", () => {
    const kind = Hyperlink.kindOf(Probe) ?? "hyperlink";
    const d1 = JSON.stringify(
      contractDescriptor(Probe.key, kind, Probe[Hyperlink.specSym]),
    );
    const d2 = JSON.stringify(
      contractDescriptor(Probe.key, kind, Probe[Hyperlink.specSym]),
    );
    expect(d1).toBe(d2);
    expect(d1).toContain('"ping"');
  });
});
