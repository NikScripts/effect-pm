import { Effect, Fiber, Layer, Schema, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import { forwardClient, groupOf, specOf } from "../src/Hyperlink";

// ── runForEachTag: tag-dispatched stream consumption (cast-free, dual, overloaded) ──
type Ev =
  | { readonly _tag: "A"; readonly n: number }
  | { readonly _tag: "B"; readonly s: string }
  | { readonly _tag: "C" };

it("runForEachTag dispatches by tag — handler map, pipeable, types inferred", () => {
  const events = Stream.fromIterable<Ev>([
    { _tag: "A", n: 1 },
    { _tag: "B", s: "x" },
    { _tag: "C" },
    { _tag: "A", n: 2 },
  ]);
  const program = Effect.gen(function* () {
    const seen: Array<string> = [];
    // pipeable + handler map; `e.n` / `e.s` only compile if inference narrowed per tag.
    yield* events.pipe(
      Hyperlink.runForEachTag({
        A: (e) => Effect.sync(() => seen.push(`A${e.n}`)),
        B: (e) => Effect.sync(() => seen.push(`B${e.s}`)),
        // C deliberately unhandled → ignored
      }),
    );
    expect(seen).toEqual(["A1", "Bx", "A2"]);

    // data-first + single tag
    const aValues: Array<number> = [];
    yield* Hyperlink.runForEachTag(events, "A", (e) =>
      Effect.sync(() => aValues.push(e.n)),
    );
    expect(aValues).toEqual([1, 2]);
  });
  return Effect.runPromise(program);
});

it("runForEachTagScoped forks into the scope and returns a Fiber (non-blocking)", () => {
  const events = Stream.fromIterable<Ev>([
    { _tag: "A", n: 1 },
    { _tag: "B", s: "x" },
    { _tag: "A", n: 2 },
  ]);
  const program = Effect.gen(function* () {
    const seen: Array<string> = [];
    // pipeable + handler map — forks automatically; we get a Fiber back, not a blocked effect.
    const fiber = yield* events.pipe(
      Hyperlink.runForEachTagScoped({
        A: (e) => Effect.sync(() => seen.push(`A${e.n}`)),
        B: (e) => Effect.sync(() => seen.push(`B${e.s}`)),
      }),
    );
    // join to observe completion deterministically (the stream is finite here)
    yield* Fiber.join(fiber);
    expect(seen).toEqual(["A1", "Bx", "A2"]);
  }).pipe(Effect.scoped);
  return Effect.runPromise(program);
});

it("effectFn rejects void or empty payloads at build time", () => {
  const effectFnAny = Hyperlink.effectFn as unknown as (payload: unknown) => unknown;
  expect(() => effectFnAny(Schema.Void)).toThrow(Hyperlink.EffectFnMissingPayload);
  expect(() => effectFnAny({})).toThrow(Hyperlink.EffectFnMissingPayload);
  expect(() => effectFnAny({ payload: Schema.Void })).toThrow(Hyperlink.EffectFnMissingPayload);
});

// A resource with both a no-payload method (property) and a payload method.
class Echo extends Hyperlink.Tag<Echo>()("test/Echo", {
  ping: Hyperlink.effect(Schema.String),
  shout: Hyperlink.effectFn({ msg: Schema.String }, Schema.String),
}) {}

// True two-sided round-trip in-process: the real `Hyperlink.server` handlers are wired to
// the same `forwardClient` the production client layer uses, over RpcTest's in-memory
// transport. So `yield* svc.*` runs the client forwarder → wire → server → impl → back.
it("client ↔ server round-trips in-memory", () => {
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(Echo));
    const svc = forwardClient(rpc, specOf(Echo), Echo.key, Echo.key);

    expect(yield* svc.ping).toBe("pong");
    expect(yield* svc.shout({ msg: "hi" })).toBe("HI");
  }).pipe(
    Effect.provide(
      Hyperlink.serveRemote(Echo, {
        ping: Effect.succeed("pong"),
        shout: ({ msg }) => Effect.succeed(msg.toUpperCase()),
      }),
    ),
    Effect.scoped,
  );
  // The group is precisely typed, so the client's `R` is honest — the program resolves
  // to `R = never` after providing the server, and runs with no cast.
  return Effect.runPromise(program);
});

// ── two solo tags with the same Spec shape on one server (wire prefix = each .key) ──
const counterSpec = {
  bump: Hyperlink.effectFn({ by: Schema.Number }, Schema.Number),
  label: Hyperlink.effect(Schema.String),
};
class Alpha extends Hyperlink.Tag<Alpha>()("test/Alpha", counterSpec) {}
class Beta extends Hyperlink.Tag<Beta>()("test/Beta", counterSpec) {}

it("two solo tags with the same Spec coexist; each has its own wire key", () => {
  let alphaTotal = 0;
  let betaTotal = 0;
  const alphaImpl = {
    bump: ({ by }: { by: number }) =>
      Effect.sync(() => (alphaTotal += by)),
    label: Effect.succeed("alpha"),
  };
  const betaImpl = {
    bump: ({ by }: { by: number }) => Effect.sync(() => (betaTotal += by)),
    label: Effect.succeed("beta"),
  };

  const root = groupOf(Alpha).merge(groupOf(Beta));
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(root);
    const a = forwardClient(rpc, specOf(Alpha), Alpha.key, Alpha.key);
    const b = forwardClient(rpc, specOf(Beta), Beta.key, Beta.key);

    expect(yield* a.label).toBe("alpha");
    expect(yield* b.label).toBe("beta");
    expect(yield* a.bump({ by: 3 })).toBe(3);
    expect(yield* b.bump({ by: 10 })).toBe(10);
    expect(yield* a.bump({ by: 4 })).toBe(7);
    expect(yield* b.bump({ by: 1 })).toBe(11);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Hyperlink.serveRemote(Alpha, alphaImpl),
        Hyperlink.serveRemote(Beta, betaImpl),
      ),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

// ── shared Spec Tag(wireKey, spec) → Factory<Self>()(instanceKey) ──
const SharedCounter = Hyperlink.Tag("test/shared-counter", counterSpec, {
  description: "A shared-Spec counter factory.",
});
class SharedAlpha extends SharedCounter<SharedAlpha>()("test/SharedAlpha") {}
class SharedBeta extends SharedCounter<SharedBeta>()("test/SharedBeta") {}

it("shared Tag factory stamps one wire key on every instance", () => {
  expect(Hyperlink.wireKeyOf(SharedAlpha)).toBe(SharedCounter.wireKey);
  expect(Hyperlink.wireKeyOf(SharedBeta)).toBe(SharedCounter.wireKey);
  expect(SharedAlpha.key).toBe("test/SharedAlpha");
  expect(SharedBeta.key).toBe("test/SharedBeta");
  expect(SharedAlpha.description).toBe("A shared-Spec counter factory.");
  expect(Hyperlink.kindOf(SharedAlpha)).toBe(SharedCounter.kind);
});

it("shared Tag serve merges under one RpcGroup and routes by key header", () => {
  let alphaTotal = 0;
  let betaTotal = 0;
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(groupOf(SharedAlpha));
    const a = forwardClient(
      rpc,
      specOf(SharedAlpha),
      SharedCounter.wireKey,
      SharedAlpha.key,
    );
    const b = forwardClient(
      rpc,
      specOf(SharedBeta),
      SharedCounter.wireKey,
      SharedBeta.key,
    );

    expect(yield* a.label).toBe("alpha");
    expect(yield* b.label).toBe("beta");
    expect(yield* a.bump({ by: 3 })).toBe(3);
    expect(yield* b.bump({ by: 10 })).toBe(10);
    expect(yield* a.bump({ by: 4 })).toBe(7);
    expect(yield* b.bump({ by: 1 })).toBe(11);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Hyperlink.serveRemote(SharedAlpha, {
          bump: ({ by }: { by: number }) =>
            Effect.sync(() => (alphaTotal += by)),
          label: Effect.succeed("alpha"),
        }),
        Hyperlink.serveRemote(SharedBeta, {
          bump: ({ by }: { by: number }) =>
            Effect.sync(() => (betaTotal += by)),
          label: Effect.succeed("beta"),
        }),
      ),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});

it("shared Tag serve rejects a duplicate instance key", async () => {
  const program = Effect.void.pipe(
    Effect.provide(
      Layer.mergeAll(
        Hyperlink.serveRemote(SharedAlpha, {
          bump: ({ by }: { by: number }) => Effect.succeed(by),
          label: Effect.succeed("a"),
        }),
        Hyperlink.serveRemote(SharedAlpha, {
          bump: ({ by }: { by: number }) => Effect.succeed(by),
          label: Effect.succeed("dup"),
        }),
      ),
    ),
    Effect.scoped,
  );
  await expect(Effect.runPromise(program)).rejects.toThrow(
    Hyperlink.DuplicateSharedInstance,
  );
});

// ── resource-level description (tools: section help / panel title) ──
class Described extends Hyperlink.Tag<Described>()("described", {
  ping: Hyperlink.effect(Schema.String),
}, {
  description: "A described resource.",
}) {}
class FamA extends Hyperlink.Tag<FamA>()(
  "describedFamily/A",
  { tick: Hyperlink.effect(Schema.Void) },
  { description: "A described family.", },
) {}

it("carries a resource-level description on tags", () => {
  expect(Described.description).toBe("A described resource.");
  expect(FamA.description).toBe("A described family.");
});

// ── shared server: two DIFFERENT resource types with a same-named method don't collide ──
class Widgets extends Hyperlink.Tag<Widgets>()("widgets", {
  size: Hyperlink.effect(Schema.Number), // same method name as Crates.size, different type
}) {}
class Crates extends Hyperlink.Tag<Crates>()("crates", {
  size: Hyperlink.effect(Schema.String),
}) {}

it("two resource types sharing a method name coexist on one server (group prefix)", () => {
  // One server nodes both: their groups merge into one root, distinguished by group prefix.
  const root = groupOf(Widgets).merge(groupOf(Crates));
  const program = Effect.gen(function* () {
    const rpc = yield* RpcTest.makeClient(root);
    const widgets = forwardClient(rpc, specOf(Widgets), Widgets.key, Widgets.key);
    const crates = forwardClient(rpc, specOf(Crates), Crates.key, Crates.key);

    // each `size` resolves to its own resource despite the shared method name
    expect(yield* widgets.size).toBe(42);
    expect(yield* crates.size).toBe("dozen");
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Hyperlink.serveRemote(Widgets, { size: Effect.succeed(42) }),
        Hyperlink.serveRemote(Crates, { size: Effect.succeed("dozen") }),
      ),
    ),
    Effect.scoped,
  );
  return Effect.runPromise(program);
});
