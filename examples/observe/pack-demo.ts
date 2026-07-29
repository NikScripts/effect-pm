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
type Phase = "idle" | "running" | "paused";
type DemoStatus = {
  sizes: { high: number; normal: number; low: number };
  paused: boolean;
  phase: Phase;
};

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
    const cell = yield* SubscriptionRef.make<DemoStatus>({
      sizes: { high: 2, normal: 5, low: 1 },
      paused: false,
      phase: "running",
    });
    const paused: DemoStatus = {
      sizes: { high: 2, normal: 5, low: 1 },
      paused: true,
      phase: "paused",
    };
    const running: DemoStatus = {
      sizes: { high: 2, normal: 5, low: 1 },
      paused: false,
      phase: "running",
    };
    return {
      status: Hyperlink.subscribable(cell),
      pause: SubscriptionRef.set(cell, paused),
      resume: SubscriptionRef.set(cell, running),
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

    yield* Effect.log("— Observe.bind(runtime)(Jobs, demoPack) —");
    yield* Effect.log(`pack id:      ${demoPack.id}`);
    yield* Effect.log(`memoized:     ${String(box === again)}`);
    yield* Effect.log(`box keys:     ${Object.keys(box).sort().join(", ")}`);
    yield* Effect.log(`shipped pack: ${WorkPoolView.pack.id}`);

    const s0 = readStatus();
    yield* Effect.log(`status:       ${s0?.phase} pending=${pendingOf(s0)}`);

    registry.set(box.pause, undefined as void);
    yield* Effect.sleep("80 millis");

    const s1 = readStatus();
    yield* Effect.log(`after pause:  ${s1?.phase} paused=${String(s1?.paused)}`);

    yield* Effect.log("");
    yield* Effect.log("React (same discharge under RuntimeProvider):");
    yield* Effect.log("  const box = Observe.use(Jobs, WorkPoolView.pack)");
    yield* Effect.log("  // or Observe.use(Jobs, demoPack)");
  }),
);
