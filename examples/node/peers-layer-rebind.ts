/**
 * @module examples/node/peers-layer-rebind
 *
 * **Directory `peersLayer` hot-rebind** — same peer `nodeKey`, new dial. East keeps one
 * `peers[West]` facade; folds move A→B after West shuts down and a successor advertises.
 *
 * ```bash
 * pnpm run example:node-peers-layer-rebind
 * ```
 *
 * Guide: `docs/guides/identity-coordinator.md` (membership push). Suite:
 * `test/lookup-d3-peers.test.ts` (hot-rebind).
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  Clock,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
} from "effect";
import { combineQuery, combineSum } from "../../src/MultiNode";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Directory from "../../src/Directory";
import * as Policy from "../../src/Policy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-peers-${label}-${String(now)}.sock`;
  });

const waitUntil = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  until: (value: A) => boolean,
) =>
  Effect.repeat(effect, {
    until,
    schedule: Schedule.spaced(Duration.millis(25)),
  });

class Pool extends Hyperlink.Tag<Pool>()("examples/peers-rebind/Pool", {
  active: Hyperlink.effect(Schema.Number),
  fleetActive: Hyperlink.effect(Schema.Number).pipe(Hyperlink.fleet),
}).pipe(Hyperlink.distributed) {}

const impl = (own: number) =>
  Effect.gen(function* () {
    const peers = yield* Hyperlink.peers(Pool);
    return {
      active: Effect.succeed(own),
      fleetActive: combineQuery(peers, (p) => p.active, combineSum).pipe(
        Effect.map((others) => own + others),
      ),
    };
  });

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const eastPath = yield* tmpSock("east");
  const westAPath = yield* tmpSock("west-a");
  const westBPath = yield* tmpSock("west-b");

  const lookupNode = Node.Tag()("examples/peers-rebind/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);

  class East extends Node.Tag<East, Pool>()("examples/peers-rebind/East", {
    path: eastPath,
  }) {}
  class West extends Node.Tag<West, Pool>()("examples/peers-rebind/West", {
    path: westAPath,
  }) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  yield* Effect.logInfo("1) West A advertises Pool=5");
  yield* Layer.build(
    Node.unix(West, [
      Hyperlink.serve(Pool, impl(5)).pipe(
        Layer.provide(Hyperlink.peersFrom(Pool, {})),
      ),
    ]).pipe(Layer.provide(lookupClient)),
  );

  const peersCtx = yield* Layer.build(
    Hyperlink.peersLayer(Pool, East).pipe(
      Policy.provide(Policy.verifyOff),
      Layer.provide(lookupClient),
    ),
  );

  const foldWest = Effect.gen(function* () {
    const peers = yield* Hyperlink.peers(Pool);
    const west = peers[West.key];
    if (west === undefined) return undefined as number | undefined;
    return yield* west.active;
  }).pipe(Effect.provide(peersCtx));

  yield* waitUntil(foldWest, (n) => n === 5);
  yield* Effect.logInfo("2) East peersLayer dials West → 5");

  yield* Effect.logInfo("3) Shutdown West A — Directory empty");
  yield* Node.shutdown(West);
  yield* waitUntil(
    Directory.nodesServing(Pool).pipe(Effect.provide(lookupCtx)),
    (rows) => rows.length === 0,
  );

  yield* Effect.logInfo("4) West B same nodeKey, new dial, Pool=9");
  class WestB extends Node.Tag<WestB, Pool>()("examples/peers-rebind/West", {
    path: westBPath,
  }) {}

  yield* Layer.build(
    Node.unix(WestB, [
      Hyperlink.serve(Pool, impl(9)).pipe(
        Layer.provide(Hyperlink.peersFrom(Pool, {})),
      ),
    ]).pipe(Layer.provide(lookupClient)),
  );

  yield* waitUntil(foldWest, (n) => n === 9);
  yield* Effect.logInfo(
    "5) Same peers[West] facade now folds B → 9 (hot-rebind)",
  );

  yield* Effect.logInfo("Done — peersLayer build-then-swap.");
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
