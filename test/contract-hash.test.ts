import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Resource from "../src/Resource";
import {
  contractDescriptor,
  hashContract,
} from "../src/internal/contractHash";

class Probe extends Resource.Tag<Probe>()("hash/Probe", {
  ping: Resource.effectFn({ n: Schema.Number }, Schema.Number),
}) {}

describe("contractHash / hashContract", () => {
  it("is stable for the same Spec", () => {
    const a = Resource.contractHash(Probe);
    const b = Resource.contractHash(Probe);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("matches hashContract on the tag Spec", () => {
    const kind = Resource.kindOf(Probe) ?? "resource";
    expect(Resource.contractHash(Probe)).toBe(
      hashContract(Probe.groupId, kind, Probe[Resource.specSym]),
    );
  });

  it("changes when a method payload schema drifts", () => {
    const kind = Resource.kindOf(Probe) ?? "resource";
    const base = Probe[Resource.specSym];
    const drifted = {
      ...base,
      ping: Resource.effectFn({ n: Schema.String }, Schema.Number),
    };
    expect(hashContract(Probe.groupId, kind, base)).not.toBe(
      hashContract(Probe.groupId, kind, drifted),
    );
  });

  it("changes when a wire method is added", () => {
    const kind = Resource.kindOf(Probe) ?? "resource";
    const base = Probe[Resource.specSym];
    const extra = {
      ...base,
      pong: Resource.effect(Schema.Void),
    };
    expect(hashContract(Probe.groupId, kind, base)).not.toBe(
      hashContract(Probe.groupId, kind, extra),
    );
  });

  it("contractDescriptor is JSON-stable (sorted keys)", () => {
    const kind = Resource.kindOf(Probe) ?? "resource";
    const d1 = JSON.stringify(
      contractDescriptor(Probe.groupId, kind, Probe[Resource.specSym]),
    );
    const d2 = JSON.stringify(
      contractDescriptor(Probe.groupId, kind, Probe[Resource.specSym]),
    );
    expect(d1).toBe(d2);
    expect(d1).toContain('"ping"');
  });
});
