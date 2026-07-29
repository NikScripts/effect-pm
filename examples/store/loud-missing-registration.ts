/**
 * @module examples/store/loud-missing-registration
 *
 * A Soft override is all-or-nothing for engines you run. If an override store includes
 * `Node.logs` but omits `WorkPool.store(tag)`, the WorkPool layer fails loudly instead of silently
 * falling back to a second journal.
 * Run: `pnpm run example:store-loud-missing-registration`
 *
 * Docs: `docs/examples/store/loud-missing-registration.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import * as Node from "../../src/Node";
import * as Store from "../../src/Store";
import * as WorkPool from "../../src/WorkPool";

class DemoNode extends Node.Tag<DemoNode>()("examples/store/missing-registration-node") {}

const Job = Schema.Struct({ id: Schema.String });

class MissingQueue extends WorkPool.Tag<MissingQueue>()("examples/store/MissingQueue", {
  payload: Job,
}) {}

class NodeOnlyStore extends Store.Service<NodeOnlyStore>("@examples/store/NodeOnlyStore")(
  DemoNode.logs,
) {}

const BadLayer = WorkPool.layer(MissingQueue, {
  effect: (job) => Effect.logInfo(`would process ${job.id}`),
}).pipe(
  // This is intentionally wrong: the override store lacks WorkPool.store(MissingQueue).
  Layer.provideMerge(NodeOnlyStore.layerMemory),
);

const program = Effect.gen(function* () {
  const exit = yield* Effect.exit(
    MissingQueue.pipe(
      // @effect-diagnostics-next-line strictEffectProvide:off
      Effect.provide(BadLayer),
      Effect.scoped,
    ),
  );

  if (exit._tag !== "Failure") {
    return yield* Effect.die("expected Soft override to fail when the queue registration is missing");
  }

  const pretty = Cause.pretty(exit.cause);
  if (!pretty.includes("Store.resolveOrDie")) {
    return yield* Effect.die(`unexpected failure cause: ${pretty}`);
  }

  yield* Effect.logInfo(`missing registration exit _tag: ${exit._tag}`);
  yield* Effect.logInfo("failure mentions Store.resolveOrDie");
  yield* Effect.logInfo(`Exit.isFailure: ${String(Exit.isFailure(exit))}`);
}).pipe(Effect.orDie);
// ---cut-after---

runNodeProgramOrExit(program, "store loud-missing-registration example finished");
