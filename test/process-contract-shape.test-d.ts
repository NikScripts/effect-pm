/**
 * Type-level proof that the composed `Process` contract resolves in `extends … .pipe(...)`
 * position and surfaces the right service shape for each variant: base, value-returning
 * (`result`), inline-scheduled (gains the `schedule` verb group), and externally-gated
 * (gains no schedule verbs). Typecheck-only.
 */
import { Effect, Option, Schema } from "effect";
import * as Process from "../src/Process";

declare const startAt: Date;
declare const stopAt: Date;

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

// base — observation + lifecycle only
class Health extends Process.Tag<Health>()("shape/Health") {}

// value-returning — gains a reactive `result` via positional resultSchema
class Prices extends Process.Tag<Prices>()("shape/Prices", Price) {}

// owns an inline schedule — gains the `schedule` verb group (id optional on windows)
class Matches extends Process.Tag<Matches>()("shape/Matches").pipe(
  Process.schedule([
    Process.window(startAt, stopAt),
    Process.window("sun-slate", startAt, stopAt),
    Process.at(startAt),
  ]),
) {}

// standalone schedule resource + a process gated by it (no schedule verbs on the process)
class SeasonSchedule extends Process.Schedule<SeasonSchedule>()("shape/SeasonSchedule") {}
class Ingest extends Process.Tag<Ingest>()("shape/Ingest").pipe(
  Process.schedule(SeasonSchedule),
) {}

const _proof = Effect.gen(function* () {
  const h = yield* Health;
  // `status` is a reactive `ref`: `.get` reads it once, `.changes` streams it.
  const _status: typeof Process.processStatus.Type = yield* h.status.get;
  yield* h.start; // no-payload verb → Effect property
  yield* h.runImmediately;
  // observability is paired by nesting (like the queue): `logs.live` stream + `logs.history` query.
  const _logHistory: ReadonlyArray<typeof Process.processLogEntry.Type> = yield* h.logs.history(
    {},
  );

  const p = yield* Prices;
  const latest: Option.Option<typeof Price.Type> = yield* p.result.get;

  const m = yield* Matches;
  const entries: ReadonlyArray<typeof Process.processScheduleEntry.Type> =
    yield* m.schedule.entries.get;
  yield* m.schedule.add(entries[0]!);
  yield* m.schedule.clear;

  const s = yield* SeasonSchedule;
  yield* s.add(entries[0]!);
  const one: Option.Option<typeof Process.processScheduleEntry.Type> = yield* s.get({ id: "x" });

  const i = yield* Ingest;
  yield* i.start;
  // @ts-expect-error a process gated by an external schedule gains NO schedule verbs
  yield* i.schedule.entries.get;

  return { _status, _logHistory, latest, one };
});

void _proof;

// The runtime layers pin the tag to the base spec; a composed tag (`+ result` / `+ schedule`) must
// still be accepted, and each grants its own `Self` so `yield* Tag` keeps the composed surface.
const _baseLocal = Process.layer(Health, { effect: Effect.void });
const _resultServe = Process.serve(Prices, {
  effect: Effect.succeed({ symbol: "AAPL", usd: 1 }),
});
const _scheduleServeRemote = Process.serveRemote(Matches, { effect: Effect.void });
const _scheduleResLocal = Process.scheduleLayer(SeasonSchedule);
const _scheduleResServe = Process.scheduleServe(SeasonSchedule, {
  initial: [Process.window("wk1", startAt, stopAt)],
});

void _baseLocal;
void _resultServe;
void _scheduleServeRemote;
void _scheduleResLocal;
void _scheduleResServe;
