/**
 * NodePolicy — listen / advertise / proxy / as via PolicyBuilder.
 */
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import * as NodePolicy from "../src/NodePolicy";
import * as LookupPolicy from "../src/LookupPolicy";

const readNodePolicy = Effect.gen(function* () {
  return {
    listen: yield* NodePolicy.Listen,
    advertise: yield* NodePolicy.Advertise,
    proxy: yield* NodePolicy.Proxy,
    as: yield* NodePolicy.As,
  };
});

describe("NodePolicy", () => {
  it.effect("Reference defaults: listen all, advertise primary, no proxy/as", () =>
    Effect.gen(function* () {
      expect(NodePolicy.Listen.key).toBe("hyperlink-ts/NodePolicy/Listen");
      const d = yield* readNodePolicy;
      expect(d.listen).toBe("all");
      expect(d.advertise).toBe("primary");
      expect(d.proxy).toBeUndefined();
      expect(d.as).toBeUndefined();
    }),
  );

  it.effect("camelCase methods + make/layer stamp config", () =>
    Effect.gen(function* () {
      const bundle = NodePolicy.make({
        Listen: ["A"],
        Advertise: "all",
        Proxy: "prefer",
        As: "A",
      });
      expect(NodePolicy.isPolicy(bundle)).toBe(true);
      expect(NodePolicy.config(bundle)).toEqual({
        Listen: ["A"],
        Advertise: "all",
        Proxy: "prefer",
        As: "A",
      });
      const viaMethods = NodePolicy.layer(
        NodePolicy.listen("primary"),
        NodePolicy.advertise(["A", "B"]),
        NodePolicy.proxy("prefer"),
        NodePolicy.as("B"),
      );
      expect(NodePolicy.config(viaMethods)).toEqual({
        Listen: "primary",
        Advertise: ["A", "B"],
        Proxy: "prefer",
        As: "B",
      });
      const d = yield* readNodePolicy.pipe(Effect.provide(viaMethods));
      expect(d.listen).toBe("primary");
      expect(d.advertise).toEqual(["A", "B"]);
      expect(d.proxy).toBe("prefer");
      expect(d.as).toBe("B");
    }),
  );

  it.effect("brands do not cross with LookupPolicy", () =>
    Effect.gen(function* () {
      expect(NodePolicy.isPolicy(LookupPolicy.sticky)).toBe(false);
      expect(LookupPolicy.isPolicy(NodePolicy.listen("all"))).toBe(false);
      expect(
        NodePolicy.isFragment("Listen")({ _tag: "Listen", value: "all" }),
      ).toBe(true);
      expect(NodePolicy.toConfig(NodePolicy.fromConfig({ As: "A" }))).toEqual({
        As: "A",
      });
    }),
  );
});
