/**
 * @module examples/logs/lineage-scope
 *
 * `Logs.withScope(tag)` appends `tag.key` to the fiber lineage. `LogEntry.lineage`,
 * `hasKey`, `atRoot`, and `atLeaf` decode and predicate on the captured annotation.
 * Run: `pnpm run example:logs-lineage-scope`
 *
 * Docs: `docs/examples/logs/lineage-scope.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Effect, Fiber, Stream } from "effect";
import * as Daemon from "../../src/Daemon";
import * as LogEntry from "../../src/LogEntry";
import * as Logs from "../../src/Logs";

class Parent extends Daemon.Tag<Parent>()("examples/logs/Parent") {}
class Child extends Daemon.Tag<Child>()("examples/logs/Child") {}

const program = Effect.gen(function* () {
  const collected = yield* Effect.forkChild(
    Logs.stream.pipe(
      Stream.filter((entry) => entry.message === "lineage: parent then child"),
      Stream.take(1),
      Stream.runCollect,
    ),
  );

  yield* Effect.logInfo("lineage: parent then child").pipe(
    Logs.withScope(Child),
    Logs.withScope(Parent),
  );

  const [entry] = Array.from(yield* Fiber.join(collected));
  if (entry === undefined) {
    return yield* Effect.die("lineage log entry was not captured");
  }

  yield* Effect.logInfo(`lineage path: ${LogEntry.lineage(entry).join(" -> ")}`);
  yield* Effect.logInfo(`has parent: ${String(LogEntry.hasKey(Parent.key)(entry))}`);
  yield* Effect.logInfo(`root is parent: ${String(LogEntry.atRoot(Parent.key)(entry))}`);
  yield* Effect.logInfo(`leaf is child: ${String(LogEntry.atLeaf(Child.key)(entry))}`);
}).pipe(
  // @effect-diagnostics-next-line strictEffectProvide:off
  Effect.provide(Logs.layer),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "logs lineage-scope example finished");
