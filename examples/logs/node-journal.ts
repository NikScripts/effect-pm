/**
 * @module examples/logs/node-journal
 *
 * `Node.logs` on a `Store.Service` registers the node-wide durable journal. `Logs.byNode`
 * reads the persisted copy after the store's tail drains the live bus.
 * Run: `pnpm run example:logs-node-journal`
 *
 * Docs: `docs/examples/logs/node-journal.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect } from "effect";
import * as Logs from "../../src/Logs";
import * as Node from "../../src/Node";
import * as Store from "../../src/Store";

class DemoNode extends Node.Service<DemoNode>()("examples/logs/node-journal") {}

class AppStore extends Store.Service<AppStore>("@examples/logs/NodeJournalStore")(
  DemoNode.logs,
) {}

const waitForNodeLine = (message: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 50; i++) {
      const rows = yield* Logs.byNode(DemoNode, { limit: 50 });
      const found = rows.find((row) => row.message === message);
      if (found !== undefined) return found;
      yield* Effect.sleep(Duration.millis(20));
    }
    return yield* Effect.die(`timed out waiting for node journal line: ${message}`);
  });

const program = Effect.gen(function* () {
  yield* Effect.logInfo("node journal: persisted through Node.logs");

  const row = yield* waitForNodeLine("node journal: persisted through Node.logs");
  const rows = yield* Logs.byNode(DemoNode, { limit: 50 });

  yield* Effect.logInfo(`node journal rows: ${String(rows.length)}`);
  yield* Effect.logInfo(`row annotation node: ${row.annotations.node ?? "<missing>"}`);
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(AppStore.layerMemory),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "logs node-journal example finished");
