/**
 * @module examples/lifecycle/make-and-tools
 *
 * Effect-shaped Lifecycle on a WorkPool: `Hyperlink.deferStart`, `Lifecycle.from`,
 * `lifecycle._tag` badge, and control verb `stop` → Off.
 *
 * Tip surface: `Lifecycle.from` / `of`, `Hyperlink.deferStart`, WorkPool `stop`.
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

class Jobs extends WorkPool.Tag<Jobs>()("examples/lifecycle/Jobs", {
  payload: Job,
}) {}

const Live = WorkPool.layer(Jobs, {
  concurrency: 1,
  effect: (job) => Effect.logInfo(`handled ${job.id}`),
}).pipe(Hyperlink.deferStart);

const assertTag = (state: { readonly _tag: string }, tag: string) =>
  state._tag === tag
    ? Effect.void
    : Effect.die(`expected lifecycle ${tag}, got ${state._tag}`);

const program = Effect.gen(function* () {
  const jobs = yield* Jobs;
  const lc = yield* Lifecycle.from(Jobs);

  // Deferred layer → Idle until start.
  yield* assertTag(yield* lc.state.get, "Idle");
  yield* assertTag(yield* jobs.lifecycle.get, "Idle");

  yield* lc.start;
  yield* assertTag(yield* lc.state.get, "Running");

  yield* jobs.add({ id: "a" });
  while ((yield* jobs.status.get).completed < 1) {
    yield* Effect.sleep(Duration.millis(10));
  }

  yield* lc.pause;
  yield* assertTag(yield* jobs.lifecycle.get, "Paused");
  yield* lc.resume;
  yield* assertTag(yield* jobs.lifecycle.get, "Running");

  // Tool projection matches the handle badge.
  const viaOf = Lifecycle.of(jobs);
  yield* assertTag(yield* viaOf.state.get, "Running");

  // stop awaits Off (graceful drain).
  yield* jobs.stop;
  yield* assertTag(yield* jobs.lifecycle.get, "Off");
  yield* Effect.logInfo("Jobs stopped — lifecycle Off");
}).pipe(Effect.provide(Live), Effect.scoped);

void Effect.runPromise(
  program.pipe(
    Effect.tap(() =>
      Effect.logInfo("example:lifecycle-make-and-tools finished OK"),
    ),
  ),
);
