import { describe, expect, it } from "@effect/vitest";
import { Config, Effect, Exit, Fiber, Option, Redacted, Stream } from "effect";
import * as DynamicConfig from "../src/DynamicConfig";
import { DynamicConfigStore } from "../src/DynamicConfig";

// `key` is a field name here — proves the bag has no Tag.key collision.
const cfg = DynamicConfig.make({
  key: DynamicConfig.swappable(
    Config.redacted("DCFG3_KEY").pipe(Config.withDefault(Redacted.make(""))),
  ),
  baseUrl: Config.string("DCFG3_BASE").pipe(
    Config.withDefault("https://api.example.com"),
  ),
  retries: DynamicConfig.swappable(
    Config.int("DCFG3_RETRIES").pipe(Config.withDefault(3)),
  ),
});

// flat extension: clone of cfg's fields + one own field
const child = DynamicConfig.extend(cfg, {
  batchSize: Config.int("DCFG3_BATCH").pipe(Config.withDefault(100)),
});

// nested field — env key is the joined path DCFG3_DB_HOST
const nestedCfg = DynamicConfig.make({
  host: DynamicConfig.swappable(
    Config.string("DCFG3_HOST").pipe(Config.nested("DCFG3_DB")),
  ),
});

// single field — swappable used on its own, no make()
const loneKey = DynamicConfig.swappable(
  Config.redacted("DCFG3_LONE").pipe(Config.withDefault(Redacted.make(""))),
);

// piped form — Config.x.pipe(..., DynamicConfig.swappable)
const pipedKey = Config.redacted("DCFG3_PIPED").pipe(
  Config.withDefault(Redacted.make("")),
  DynamicConfig.swappable,
);

const withLayer = <A, E>(
  effect: Effect.Effect<A, E, DynamicConfigStore>,
) => effect.pipe(Effect.provide(DynamicConfig.layer));

describe("DynamicConfig (bag + field-method control)", () => {
  it.effect("reads are native and return defaults; field named `key` works", () =>
    withLayer(
      Effect.gen(function* () {
        expect(Redacted.value(yield* cfg.key)).toBe("");
        expect(yield* cfg.baseUrl).toBe("https://api.example.com");
        expect(yield* cfg.retries).toBe(3);
      }),
    ),
  );

  it.effect("set swaps; the next read reflects it", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.key.set("rotated");
        expect(Redacted.value(yield* cfg.key)).toBe("rotated");
        expect(yield* cfg.baseUrl).toBe("https://api.example.com");
      }),
    ),
  );

  it.effect("USE CASE: an independent raw Config reader sees the swap", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.key.set("shared");
        const raw = Config.redacted("DCFG3_KEY");
        expect(Redacted.value(yield* raw)).toBe("shared");
      }),
    ),
  );

  it.effect("invalid swap fails with ConfigError; state intact", () =>
    withLayer(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(cfg.retries.set("nope"));
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* cfg.retries).toBe(3);
      }),
    ),
  );

  it.effect("reset reverts to env/default", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.key.set("temp");
        expect(Redacted.value(yield* cfg.key)).toBe("temp");
        yield* cfg.key.reset;
        expect(Redacted.value(yield* cfg.key)).toBe("");
      }),
    ),
  );

  it.effect("extend clones fields; swapping the shared key is seen via the child", () =>
    withLayer(
      Effect.gen(function* () {
        expect(yield* child.batchSize).toBe(100); // own
        yield* cfg.key.set("rotated-via-base"); // control the base field
        expect(Redacted.value(yield* child.key)).toBe("rotated-via-base"); // child sees it
      }),
    ),
  );

  it.effect("changes reflects a swapped key", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.key.set("notify");
        const head = yield* Stream.runHead(cfg.key.changes);
        const keys = Option.getOrElse(head, () => [] as ReadonlyArray<string>);
        expect(keys).toContain("DCFG3_KEY");
      }),
    ),
  );

  it.effect("setByKey enforces the per-runtime allowlist and validates", () =>
    withLayer(
      Effect.gen(function* () {
        // declared-swappable key → works
        yield* DynamicConfig.setByKey("DCFG3_KEY", "via-key");
        expect(Redacted.value(yield* cfg.key)).toBe("via-key");
        // undeclared key → rejected by the allowlist
        const notAllowed = yield* Effect.exit(
          DynamicConfig.setByKey("DCFG3_UNDECLARED", "x"),
        );
        expect(Exit.isFailure(notAllowed)).toBe(true);
        // declared but invalid value → rejected by validation
        const invalid = yield* Effect.exit(
          DynamicConfig.setByKey("DCFG3_RETRIES", "not-a-number"),
        );
        expect(Exit.isFailure(invalid)).toBe(true);
      }),
    ),
  );

  it.effect("a single swappable field works on its own, no make()", () =>
    withLayer(
      Effect.gen(function* () {
        expect(Redacted.value(yield* loneKey)).toBe(""); // read directly
        yield* loneKey.set("lone-rotated"); // swap directly
        expect(Redacted.value(yield* loneKey)).toBe("lone-rotated");
      }),
    ),
  );

  it.effect("the piped form (.pipe(DynamicConfig.swappable)) works the same", () =>
    withLayer(
      Effect.gen(function* () {
        yield* pipedKey.set("piped-rotated");
        expect(Redacted.value(yield* pipedKey)).toBe("piped-rotated");
        // and it joined the allowlist on its own
        yield* DynamicConfig.setByKey("DCFG3_PIPED", "by-key");
        expect(Redacted.value(yield* pipedKey)).toBe("by-key");
      }),
    ),
  );

  it.effect("reset of a never-overridden field is a no-op", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.retries.reset; // never set
        expect(yield* cfg.retries).toBe(3); // still default, no error
      }),
    ),
  );

  it.effect("state is isolated per provision", () =>
    Effect.gen(function* () {
      // runtime A swaps in its own provision
      yield* withLayer(cfg.key.set("runtime-a"));
      // runtime B, a fresh provision, doesn't see A's swap
      const fresh = yield* withLayer(
        Effect.map(cfg.key, Redacted.value),
      );
      expect(fresh).toBe("");
    }),
  );

  it.effect("nested-key swap is seen by a raw nested reader", () =>
    withLayer(
      Effect.gen(function* () {
        yield* nestedCfg.host.set("db.prod");
        const raw = Config.string("DCFG3_HOST").pipe(Config.nested("DCFG3_DB"));
        expect(yield* raw).toBe("db.prod"); // DCFG3_DB_HOST override resolved
      }),
    ),
  );

  it.effect("a forked + scoped worker inherits the provider and sees a swap", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.key.set("for-worker");
        const worker = Effect.scoped(Effect.map(cfg.key, Redacted.value));
        const fiber = yield* Effect.forkChild(worker);
        expect(yield* Fiber.join(fiber)).toBe("for-worker");
      }),
    ),
  );

  it.effect("all reads the whole config as one object, and converts to/from make", () =>
    withLayer(
      Effect.gen(function* () {
        yield* cfg.key.set("whole");
        // all(makeBag) → yield the whole shape at once
        const obj = yield* DynamicConfig.all(cfg);
        expect(Redacted.value(obj.key)).toBe("whole");
        expect(obj.baseUrl).toBe("https://api.example.com");
        expect(obj.retries).toBe(3);
        // make(all(...)) → back to a bag with per-field accessors
        const bag = DynamicConfig.make(DynamicConfig.all(cfg));
        yield* bag.key.set("back-to-bag");
        expect(Redacted.value(yield* bag.key)).toBe("back-to-bag");
      }),
    ),
  );

  it.effect("freeze gives a read-only view that still reads the live value", () =>
    withLayer(
      Effect.gen(function* () {
        const safe = DynamicConfig.freeze(cfg);
        yield* cfg.key.set("rotated-by-owner"); // owner still swaps
        expect(Redacted.value(yield* safe.key)).toBe("rotated-by-owner"); // reader sees it
      }),
    ),
  );
});

const frozen = DynamicConfig.freeze(cfg);
const partial = DynamicConfig.freezeField(cfg, "key");

// Type-level: control is restricted to swappable fields, and freeze strips it.
const _typeChecks = () => [
  cfg.key.set("ok"),
  cfg.retries.set("5"),
  child.key.set("ok"), // inherited swappable
  partial.retries.set("5"), // freezeField left retries swappable
  // @ts-expect-error baseUrl is a FixedField, not swappable
  cfg.baseUrl.set("no"),
  // @ts-expect-error batchSize is a FixedField, not swappable
  child.batchSize.set("no"),
  // @ts-expect-error freeze made every field fixed
  frozen.key.set("no"),
  // @ts-expect-error freezeField froze `key`
  partial.key.set("no"),
];
void _typeChecks;
