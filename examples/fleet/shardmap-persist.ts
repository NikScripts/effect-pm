/**
 * @module examples/fleet/shardmap-persist
 *
 * ShardMap's local shard is keyed SQLite. Pass `{ filename }` to persist rows
 * across layer rebuilds for the same ShardMap tag key.
 *
 * Run: `pnpm run example:fleet-shardmap-persist`
 *
 * Docs: `docs/examples/fleet/shardmap-persist.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Clock, Effect, Layer, Option, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";
import * as ShardMap from "../../src/ShardMap";

class SoloNode extends Node.Service<SoloNode>()("examples/fleet/SoloNode") {}

const Session = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
});

class Sessions extends ShardMap.Service<Sessions>()("examples/fleet/PersistedSessions", {
  key: Schema.String,
  value: Session,
  keyOf: (session) => session.id,
}).pipe(Hyperlink.nodes([SoloNode])) {}

const layerFor = (filename: string) =>
  ShardMap.layer(Sessions, { filename }).pipe(
    Layer.provide(Hyperlink.peersFrom(Sessions, {})),
    Layer.provide(Hyperlink.selfNodeLayer(Sessions, SoloNode)),
  );

const program = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const filename = `/tmp/hyperlink-ts-shardmap-${String(now)}.sqlite`;

  yield* Effect.gen(function* () {
    const sessions = yield* Sessions;
    yield* sessions.put({ id: "session-1", userId: "user-a" });
    yield* Effect.logInfo("persisted session-1");
  }).pipe(Effect.provide(layerFor(filename)), Effect.scoped);

  yield* Effect.gen(function* () {
    const sessions = yield* Sessions;
    const loaded = yield* sessions.get("session-1");
    yield* Effect.logInfo(
      `loaded after rebuild: ${Option.isSome(loaded) ? loaded.value.userId : "missing"}`,
    );
    if (Option.isNone(loaded)) {
      return yield* Effect.die(new Error("expected persisted session"));
    }
  }).pipe(Effect.provide(layerFor(filename)), Effect.scoped);
});
// ---cut-after---

runNodeProgramOrExit(program, "example:fleet-shardmap-persist finished OK");
