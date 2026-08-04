/**
 * @module examples/daemon/tag-schedule
 *
 * `Daemon.schedule([...])` is a Tag combinator. The scheduled tag owns an
 * in-memory schedule and gains the `schedule.entries` / `set` / `add` / `clear`
 * control surface.
 *
 * Run: `pnpm run example:daemon-tag-schedule`
 *
 * Docs: `docs/examples/daemon/tag-schedule.md` includes this file;
 * cut markers hide the module header and demo harness from the page.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { DateTime, Effect } from "effect";
import * as Daemon from "../../src/Daemon";

const firstRun = DateTime.toDateUtc(DateTime.makeUnsafe(4_102_444_800_000));

class ScheduledReport extends Daemon.Service<ScheduledReport>()(
  "examples/daemon/ScheduledReport",
).pipe(Daemon.schedule([Daemon.at("first-run", firstRun)])) {}

const program = Effect.gen(function* () {
  const daemon = yield* ScheduledReport;
  const entries = yield* daemon.schedule.entries.get;
  const first = entries[0];
  yield* Effect.logInfo(
    `scheduled entries=${String(entries.length)} first=${first?.id ?? "none"}`,
  );

  yield* daemon.schedule.clear;
  const afterClear = yield* daemon.schedule.entries.get;
  if (afterClear.length !== 0 || (first !== undefined && first.id !== "first-run")) {
    return yield* Effect.die(new Error("unexpected schedule state"));
  }
}).pipe(
  Effect.provide(
    Daemon.layer(ScheduledReport, {
      effect: Effect.logInfo("scheduled report tick"),
    }),
  ),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "example:daemon-tag-schedule finished OK");
