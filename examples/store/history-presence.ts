/**
 * @module examples/store/history-presence
 *
 * `HistoryStore` is presence-driven. Omit it and history capture is off; provide it and stream
 * history can append/read rows. WorkPool metrics use this same optional service internally.
 * Run: `pnpm run example:store-history-presence`
 *
 * Docs: `docs/examples/store/history-presence.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Effect, Option } from "effect";
import { HistoryStore } from "../../src/HistoryStore";

const streamId = "examples/store/history-presence/metrics";

const recordIfHistoryIsPresent = (label: string) =>
  Effect.gen(function* () {
    const history = yield* Effect.serviceOption(HistoryStore);
    if (Option.isNone(history)) {
      return [] as ReadonlyArray<unknown>;
    }

    yield* history.value.append(streamId, {
      label,
      completed: 1,
    });
    return yield* history.value.read(streamId, { limit: 10 });
  });

const program = Effect.gen(function* () {
  const omitted = yield* recordIfHistoryIsPresent("omitted");
  const provided = yield* recordIfHistoryIsPresent("provided").pipe(
    // @effect-diagnostics-next-line strictEffectProvide:off
    Effect.provide(HistoryStore.layerMemory()),
  );

  yield* Effect.logInfo(`history rows without HistoryStore: ${String(omitted.length)}`);
  yield* Effect.logInfo(`history rows with HistoryStore: ${String(provided.length)}`);
}).pipe(Effect.orDie);
// ---cut-after---

runNodeProgramOrExit(program, "store history-presence example finished");
