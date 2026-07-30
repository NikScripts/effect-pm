/**
 * @module examples/node/launch-shutdown
 *
 * **`Node.launch` vs bare `Layer.launch`** — race the listen layer against the
 * shutdown latch so `Node.shutdown` ends the process fiber (no `process.exit`).
 *
 * ```bash
 * pnpm run example:node-launch-shutdown
 * ```
 *
 * Guide: `docs/guides/identity-coordinator.md`. Suite: `test/node-shutdown.test.ts`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  Clock,
  Duration,
  Effect,
  Fiber,
  Layer,
  Schema,
} from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Directory from "../../src/Directory";
import * as Policy from "../../src/Policy";
import * as Node from "../../src/Node";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-demo-launch-${label}-${String(now)}.sock`;
  });

class Jobs extends Hyperlink.Tag<Jobs>()("examples/launch-shutdown/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const program = Effect.gen(function* () {
  const lookupPath = yield* tmpSock("lookup");
  const workerPath = yield* tmpSock("worker");

  const lookupNode = Node.Tag()("examples/launch-shutdown/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);

  class Worker extends Node.Tag<Worker, Jobs>()(
    "examples/launch-shutdown/Worker",
    { path: workerPath },
  ) {}

  const lookupClient = Lookup.client(lookupNode);
  yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));
  const lookupCtx = yield* Layer.build(lookupClient);

  yield* Effect.logInfo("1) Node.launch(Worker, listen) — prefer over Layer.launch");
  const listenFiber = yield* Effect.forkScoped(
    Node.launch(
      Worker,
      Node.unix(Worker, [
        Hyperlink.serve(Jobs, { ping: Effect.succeed("ok") }),
      ]).pipe(
        Policy.provide(Policy.verifyOff),
        Layer.provide(lookupClient),
      ),
    ),
  );

  yield* Effect.sleep(Duration.millis(150));
  yield* Effect.logInfo("2) Worker in Directory — dial Node.shutdown");
  const before = yield* Directory.nodesServing(Jobs).pipe(
    Effect.provide(lookupCtx),
  );
  if (before.length !== 1) {
    return yield* Effect.die(
      new Error(`expected 1 Directory row, got ${String(before.length)}`),
    );
  }

  yield* Node.shutdown(Worker);

  yield* Fiber.join(listenFiber).pipe(Effect.timeout(Duration.seconds(5)));
  yield* Effect.logInfo("3) Listen fiber exited — shutdown latch fired");

  const after = yield* Directory.nodesServing(Jobs).pipe(
    Effect.provide(lookupCtx),
  );
  if (after.length !== 0) {
    return yield* Effect.die(
      new Error(`expected empty Directory, got ${String(after.length)}`),
    );
  }

  yield* Effect.logInfo("Done — Node.launch ends with Node.shutdown.");
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
