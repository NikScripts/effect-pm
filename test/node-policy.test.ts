/**
 * NodePolicy — primary set / listen / advertise / proxy / as via PolicyBuilder.
 */
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as NodePolicy from "../src/NodePolicy";
import * as LookupPolicy from "../src/LookupPolicy";

const readNodePolicy = Effect.gen(function* () {
  return {
    primaryAddress: yield* NodePolicy.PrimaryAddress,
    listen: yield* NodePolicy.Listen,
    advertise: yield* NodePolicy.Advertise,
    proxy: yield* NodePolicy.Proxy,
    as: yield* NodePolicy.As,
  };
});

describe("NodePolicy", () => {
  it.effect("Reference defaults: AllUnlabeled / All / Primary; no proxy/as", () =>
    Effect.gen(function* () {
      expect(NodePolicy.PrimaryAddress.key).toBe(
        "hyperlink-ts/NodePolicy/PrimaryAddress",
      );
      const d = yield* readNodePolicy;
      expect(d.primaryAddress).toBe("AllUnlabeled");
      expect(d.listen).toBe("All");
      expect(d.advertise).toBe("Primary");
      expect(d.proxy).toBeUndefined();
      expect(d.as).toBeUndefined();
    }),
  );

  it.effect("camelCase methods + make/layer stamp PascalCase modes", () =>
    Effect.gen(function* () {
      const bundle = NodePolicy.make({
        PrimaryAddress: "AllUnlabeled",
        Listen: ["A"],
        Advertise: "All",
        Proxy: "Prefer",
        As: "A",
      });
      expect(NodePolicy.isPolicy(bundle)).toBe(true);
      expect(NodePolicy.config(bundle)).toEqual({
        PrimaryAddress: "AllUnlabeled",
        Listen: ["A"],
        Advertise: "All",
        Proxy: "Prefer",
        As: "A",
      });
      const viaMethods = NodePolicy.layer(
        NodePolicy.primaryAddress("All"),
        NodePolicy.listen("Primary"),
        NodePolicy.advertise(["A", "B"]),
        NodePolicy.proxy("Prefer"),
        NodePolicy.as("B"),
      );
      expect(NodePolicy.config(viaMethods)).toEqual({
        PrimaryAddress: "All",
        Listen: "Primary",
        Advertise: ["A", "B"],
        Proxy: "Prefer",
        As: "B",
      });
      const d = yield* readNodePolicy.pipe(Effect.provide(viaMethods));
      expect(d.primaryAddress).toBe("All");
      expect(d.listen).toBe("Primary");
      expect(d.advertise).toEqual(["A", "B"]);
      expect(d.proxy).toBe("Prefer");
      expect(d.as).toBe("B");
    }),
  );

  it.effect("brands do not cross with LookupPolicy", () =>
    Effect.gen(function* () {
      expect(NodePolicy.isPolicy(LookupPolicy.sticky)).toBe(false);
      expect(LookupPolicy.isPolicy(NodePolicy.listen("All"))).toBe(false);
      expect(
        NodePolicy.isFragment("Listen")({ _tag: "Listen", value: "All" }),
      ).toBe(true);
      expect(NodePolicy.toConfig(NodePolicy.fromConfig({ As: "A" }))).toEqual({
        As: "A",
      });
    }),
  );
});
