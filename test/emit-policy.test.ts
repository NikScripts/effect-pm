/**
 * Step 5.2 — emit-policy foundation: the `EmitPolicy` runtime union, author
 * markers, and the `EmitPolicyOverride` config-wire schema + decode. The field
 * catalog / `layer` overrides build on these.
 */
import { describe, expect, it } from "@effect/vitest";
import { Duration, Schema } from "effect";
import { EmitPolicyOverrideSchema, State } from "../src/State";

describe("State emit-policy markers", () => {
  it("constant markers carry their tag", () => {
    expect(State.immediateEmit).toEqual({ _tag: "immediate" });
    expect(State.noEmit).toEqual({ _tag: "never" });
    expect(State.deferEmit).toEqual({ _tag: "defer" });
  });

  it("duration markers parse a Duration.Input", () => {
    const debounce = State.debounceEmit("250 millis");
    expect(debounce._tag).toBe("debounce");
    if (debounce._tag === "debounce") {
      expect(Duration.toMillis(debounce.duration)).toBe(250);
    }
    const rate = State.rateLimitEmit("500 millis");
    expect(rate._tag).toBe("rateLimit");
    if (rate._tag === "rateLimit") {
      expect(Duration.toMillis(rate.duration)).toBe(500);
    }
  });
});

describe("EmitPolicyOverride", () => {
  it("decodes bare and duration overrides to EmitPolicy", () => {
    expect(State.decodeEmitPolicyOverride("immediate")).toEqual({ _tag: "immediate" });
    expect(State.decodeEmitPolicyOverride("never")).toEqual({ _tag: "never" });
    expect(State.decodeEmitPolicyOverride("defer")).toEqual({ _tag: "defer" });

    const debounce = State.decodeEmitPolicyOverride({ debounce: "100 millis" });
    expect(debounce._tag).toBe("debounce");
    if (debounce._tag === "debounce") {
      expect(Duration.toMillis(debounce.duration)).toBe(100);
    }
    const rate = State.decodeEmitPolicyOverride({ rateLimit: "1 minutes" });
    expect(rate._tag).toBe("rateLimit");
    if (rate._tag === "rateLimit") {
      expect(Duration.toMillis(rate.duration)).toBe(60_000);
    }
  });

  it("schema accepts the wire forms and rejects junk", () => {
    expect(Schema.decodeUnknownSync(EmitPolicyOverrideSchema)("defer")).toBe("defer");
    expect(
      Schema.decodeUnknownSync(EmitPolicyOverrideSchema)({ debounce: "250 millis" }),
    ).toEqual({ debounce: "250 millis" });
    expect(() => Schema.decodeUnknownSync(EmitPolicyOverrideSchema)("nonsense")).toThrow();
    expect(() => Schema.decodeUnknownSync(EmitPolicyOverrideSchema)({ wrong: "x" })).toThrow();
  });
});
