/**
 * @module examples/observe/pack-demo
 *
 * **Observe recipes demo** — bind a compositional pack under `Atom.runtime`,
 * read status, fire `pause`. Same stack skins use via `Observe.use` in React.
 *
 * ```bash
 * pnpm run example:observe-pack-demo
 * ```
 *
 * React call site (under RuntimeProvider):
 * ```tsx
 * const box = Observe.use(Jobs, WorkPoolView.pack)
 * const status = useAtomValue(box.status)
 * const pause = useAtomSet(box.pause)
 * ```
 */

// ---cut---
import { Effect, Schema, SubscriptionRef, pipe } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import * as Hyperlink from "../../src/Hyperlink";
import * as Observe from "../../src/Observe";
import * as WorkPoolView from "../../src/ui/WorkPoolView";

const Status = Schema.Struct({
  sizes: Schema.Struct({
    high: Schema.Number,
    normal: Schema.Number,
    low: Schema.Number,
  }),
  paused: Schema.Boolean,
  phase: Schema.Literals(["idle", "running", "paused"]),
});

class Jobs extends Hyperlink.Tag<Jobs>()("demo/observe/Jobs", {
  status: Hyperlink.ref(Status),
  pause: Hyperlink.effect(Schema.Void),
  resume: Hyperlink.effect(Schema.Void),
  clear: Hyperlink.effect(Schema.Void),
  shutdown: Hyperlink.effect(Schema.Void),
}) {}

/** Card surface without node-scoped logs (local demo Tag has no Node). */
const demoPack = Observe.named(
  "demo/jobs-card",
  pipe(
    Observe.struct({
      status: Observe.atom((q: Jobs["Service"]) => q.status),
    }),
    Observe.and(WorkPoolView.queueControls),
  ),
);

const layer = Hyperlink.layer(
  Jobs,
  Effect.gen(function* () {
    const cell = yield* SubscriptionRef.make({
      sizes: { high: 2, normal: 5, low: 1 },
      paused: false,
      phase: "running" as const,
    });
    return {
      status: Hyperlink.subscribable(cell),
      pause: SubscriptionRef.set(cell, {
        sizes: { high: 2, normal: 5, low: 1 },
        paused: true,
        phase: "paused" as const,
      }),
      resume: SubscriptionRef.set(cell, {
        sizes: { high: 2, normal: 5, low: 1 },
        paused: false,
        phase: "running" as const,
      }),
      clear: Effect.void,
      shutdown: Effect.void,
    };
  }),
);

const runtime = Atom.runtime(layer);
const box = Observe.bind(runtime)(Jobs, demoPack);
const again = Observe.bind(runtime)(Jobs, demoPack);

const registry = AtomRegistry.make();
registry.mount(box.status);

const readStatus = () => {
  const r = registry.get(box.status);
  return AsyncResult.isSuccess(r) ? r.value : undefined;
};

const pendingOf = (
  s:
    | {
        readonly sizes: {
          readonly high: number;
          readonly normal: number;
          readonly low: number;
        };
      }
    | undefined,
): number =>
  s === undefined ? 0 : s.sizes.high + s.sizes.normal + s.sizes.low;

await Effect.runPromise(
  Effect.gen(function* () {
    yield* Effect.sleep("80 millis");

    console.log("— Observe.bind(runtime)(Jobs, demoPack) —");
    console.log("pack id:     ", demoPack.id);
    console.log("memoized:    ", box === again);
    console.log("box keys:    ", Object.keys(box).sort().join(", "));
    console.log("shipped pack:", WorkPoolView.pack.id);

    const s0 = readStatus();
    console.log("status:      ", s0?.phase, `pending=${pendingOf(s0)}`);

    registry.set(box.pause, undefined as void);
    yield* Effect.sleep("80 millis");

    const s1 = readStatus();
    console.log("after pause: ", s1?.phase, `paused=${s1?.paused}`);

    console.log("");
    console.log("React (same discharge under RuntimeProvider):");
    console.log("  const box = Observe.use(Jobs, WorkPoolView.pack)");
    console.log("  // or Observe.use(Jobs, demoPack)");
  }),
);
