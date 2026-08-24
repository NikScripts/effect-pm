/**
 * @module examples/lifecycle/make-and-tools
 *
 * Effect-shaped Lifecycle on a WorkPool: `Hyperlink.deferStart`, Participating
 * duals (`Lifecycle.start(jobs)`), `lifecycle._tag` badge, and `stop` → Off.
 *
 * Tip surface: `Lifecycle.start(jobs|Tag)`, `Hyperlink.deferStart`, WorkPool `stop`.
 * Run: `pnpm run example:lifecycle-make-and-tools`
 *
 * Docs: `docs/examples/lifecycle/make-and-tools.md` includes this file via Twoslash;
 * `// ---cut---` hides this module header from the page.
 */

// ---cut---
import { Duration, Effect, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lifecycle from "../../src/Lifecycle";
import { WorkPool } from "../../src";

const Job = Schema.Struct({ id: Schema.String });

class Jobs extends WorkPool.Service<Jobs>()("examples/lifecycle/Jobs", {
  payload: Job,
}) {}

const layer = WorkPool.layer(Jobs, {
  concurrency: 1,
  effect: (job) => Effect.logInfo(`handled ${job.id}`),
}).pipe(Hyperlink.deferStart);

const assertTag = (state: { readonly _tag: string }, tag: string) =>
  state._tag === tag
    ? Effect.void
    : Effect.die(`expected lifecycle ${tag}, got ${state._tag}`);

const program = Effect.gen(function* () {
  const jobs = yield* Jobs;

  // Deferred layer → Idle until start.
  yield* assertTag(yield* jobs.lifecycle.get, "Idle");

  yield* Lifecycle.start(jobs);
  yield* assertTag(yield* jobs.lifecycle.get, "Running");

  yield* jobs.add({ id: "a" });
  while ((yield* jobs.status.get).completed < 1) {
    yield* Effect.sleep(Duration.millis(10));
  }

  yield* Lifecycle.pause(jobs);
  yield* assertTag(yield* jobs.lifecycle.get, "Paused");
  yield* Lifecycle.resume(jobs);
  yield* assertTag(yield* jobs.lifecycle.get, "Running");

  // Tag overload (same as Lifecycle.start(jobs)).
  yield* Lifecycle.start(Jobs);

  // stop awaits Off (graceful drain).
  yield* jobs.stop;
  yield* assertTag(yield* jobs.lifecycle.get, "Off");
  yield* Effect.logInfo("Jobs stopped — lifecycle Off");
}).pipe(Effect.provide(layer), Effect.scoped);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() =>
      Effect.logInfo("example:lifecycle-make-and-tools finished OK"),
    ),
  ),
);
