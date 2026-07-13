/**
 * Type-level proof that the composed `Process` contract resolves in `extends … .pipe(...)`
 * position and surfaces the right service shape for each variant: base, value-returning
 * (`result`), inline-scheduled (gains the `schedule` verb group), and externally-gated
 * (gains no schedule verbs). Typecheck-only.
 */
import { Effect, Option, Schema } from "effect";
import * as Process from "../src/Process";
import * as Resource from "../src/Resource";

declare const startAt: Date;
declare const stopAt: Date;

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

// base — observation + lifecycle only
class Health extends Process.Tag<Health>()("shape/Health") {}

// value-returning — gains a reactive `result` via positional success
class Prices extends Process.Tag<Prices>()("shape/Prices", { success: Price }) {}

class PricedErr extends Process.Tag<PricedErr>()("shape/PricedErr", {
  success: Price,
  error: Schema.TaggedStruct("FetchError", { status: Schema.Number }),
}) {}

// error stamp surfaces on manual `run` RPC when stamped (see process-run-rpc.test.ts)
void Process.errorOf(PricedErr);

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
  yield* h.start; // void lifecycle command
  yield* h.run;
  const _logExport = yield* Resource.logs(Health);
  const _logHistory: ReadonlyArray<typeof Process.processLogEntry.Type> = yield* _logExport.query({});

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

  const pe = yield* PricedErr;
  const _pricedRun: Effect.Effect<
    typeof Price.Type,
    { readonly _tag: "FetchError"; readonly status: number }
  > = pe.run;

  return { _status, _logHistory, latest, one, _pricedRun };
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
