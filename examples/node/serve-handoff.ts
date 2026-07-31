/**
 * @module examples/node/serve-handoff
 *
 * **Serve-site `{ handoff }`** (Locked #39) — custom migration fn on
 * `Hyperlink.serve`, not WorkPool's baked `releaseEnqueueHandoff` and not
 * Launcher custody `Handle.handoff`.
 *
 * No Directory peer → `HandoffDeferred` (`reason: "NoPeer"`); node stays up
 * (`phase` restored to `running`).
 *
 * ```bash
 * pnpm run example:node-serve-handoff
 * ```
 *
 * Guide: `docs/guides/identity-coordinator.md`. Suite: `test/hyperlink-handoff.test.ts`.
 * Contrast: `examples/node/handoff-ab-cutover.ts` (WorkPool bake).
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Effect, Layer, Predicate, Ref, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Policy from "../../src/Policy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-serve-handoff-${label}-${String(now)}.sock`;
  });

class Mover extends Hyperlink.Tag<Mover>()("examples/serve-handoff/Mover", {
  take: Hyperlink.effect(Schema.Array(Schema.String)),
  give: Hyperlink.effectFn(Schema.Array(Schema.String), Schema.Void),
}) {}

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const workerPath = yield* tmpSock("worker");

  const lookupNode = Node.Tag()("examples/serve-handoff/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);

  class Worker extends Node.Tag<Worker, Mover>()(
    "examples/serve-handoff/Worker",
    { path: workerPath },
  ) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));

  const store = yield* Ref.make<ReadonlyArray<string>>(["job-1"]);

  yield* Layer.build(
    Node.unix(Worker, [
      Hyperlink.serve(
        Mover,
        {
          take: Effect.gen(function* () {
            const items = yield* Ref.get(store);
            yield* Ref.set(store, []);
            return items;
          }),
          give: (items: ReadonlyArray<string>) =>
            Ref.update(store, (a) => [...a, ...items]),
        },
        {
          handoff: (
            from: { readonly take: Effect.Effect<ReadonlyArray<string>> },
            to: {
              readonly give: (
                items: ReadonlyArray<string>,
              ) => Effect.Effect<void>;
            },
            ctx,
          ) =>
            Effect.gen(function* () {
              const items = yield* from.take;
              if (items.length === 0) return yield* ctx.done;
              yield* to.give(items);
              return yield* ctx.done;
            }),
        },
      ),
    ]).pipe(
      Policy.provide(Policy.verifyOff),
      Layer.provide(lookupClient),
    ),
  );

  yield* Effect.logInfo(
    "1) Only one Mover advertiser — shutdown has no peer to dial",
  );

  const err = yield* Effect.flip(Node.shutdown(Worker));
  if (!Predicate.isTagged(err, "HandoffDeferred")) {
    return yield* Effect.die(
      new Error(`expected HandoffDeferred, got ${String((err as { _tag?: string })._tag)}`),
    );
  }
  if (err.reason !== "NoPeer" || err.serviceKey !== Mover.key) {
    return yield* Effect.die(
      new Error(
        `expected NoPeer on ${Mover.key}, got reason=${err.reason} key=${err.serviceKey}`,
      ),
    );
  }

  // Node stayed up — Jobs store still has work after a failed take? take emptied then
  // deferred before give; restore check: phase is running again via status.
  const nodeCtx = yield* Layer.build(
    Node.connect(Worker).pipe(Policy.provide(Policy.verifyOff)),
  );
  const snap = yield* Effect.gen(function* () {
    const node = yield* Worker;
    return yield* node.status.get;
  }).pipe(Effect.provide(nodeCtx));

  if (snap.phase !== "running" || snap.up !== true) {
    return yield* Effect.die(
      new Error(`expected running after defer, got phase=${snap.phase}`),
    );
  }

  yield* Effect.logInfo(
    `Done — HandoffDeferred NoPeer; node still up (phase=${snap.phase}).`,
  );
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
