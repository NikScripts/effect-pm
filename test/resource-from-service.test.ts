import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import * as Resource from "../src/Resource";

// `fromService`: an existing service **interface** is the source of truth. The contract gives a schema
// only for the wired member (`add`); every other interface member becomes a local, written **bare**
// (`Resource.local`, no `()`), its type taken from the interface. One merged handle: wired + local
// members sit together; the locals just carry a `Local<CounterShape>` requirement that the local layer
// grants (and a client can't). The interface is a standalone type — passing the class itself would be
// a circular base reference.
interface CounterShape {
  readonly current: Effect.Effect<number>; // local effect
  readonly add: (by: number) => Effect.Effect<number>; // wired
  readonly admin: {
    readonly reset: Effect.Effect<void>; // nested local effect
  };
  readonly label: string; // local raw value → Effect<string, Local>
}
class Counter extends Resource.fromService<Counter, CounterShape>()("from-svc/Counter", {
  current: Resource.local,
  add: Resource.effectFn(Schema.Number, Schema.Number),
  admin: {
    reset: Resource.local,
  },
  label: Resource.local,
}) {}

it("fromService merged handle serves wired + local (effect / nested / raw value) via the local layer", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      // The impl is the service itself — the wired handler plus each local's interface-shaped value.
      // `ImplOf` types each local from the interface (a wrong-typed local impl would not compile).
      const layer = Resource.layer(Counter, {
        current: Effect.succeed(5),
        add: (by: number) => Effect.succeed(by + 1),
        admin: { reset: Effect.void },
        label: "ctr",
      });

      yield* Effect.gen(function* () {
        const c = yield* Counter;
        // local effect — passes through, its Local requirement satisfied by the granted cap:
        expect(yield* c.current).toBe(5);
        // wired member — a normal client method:
        expect(yield* c.add(41)).toBe(42);
        // nested local effect:
        yield* c.admin.reset;
        // raw-value local — lifted to Effect<string, Local>, `yield*` obtains it:
        expect(yield* c.label).toBe("ctr");
      }).pipe(Effect.provide(layer));
    }),
  ));
