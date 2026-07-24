/**
 * Type-level proof that the composed `Daemon` contract resolves in `extends … .pipe(...)`
 * position and surfaces the right service shape for each variant: base, value-returning
 * (`result`), inline-scheduled (gains the `schedule` verb group), and externally-gated
 * (gains no schedule verbs). Typecheck-only.
 */
import { Effect, Option, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Hyperlink from "../src/Hyperlink";

declare const startAt: Date;
declare const stopAt: Date;

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

// base — observation + lifecycle only
class Health extends Daemon.Tag<Health>()("shape/Health") {}

// value-returning — gains a reactive `result` via positional success
class Prices extends Daemon.Tag<Prices>()("shape/Prices", { success: Price }) {}

class PricedErr extends Daemon.Tag<PricedErr>()("shape/PricedErr", {
  success: Price,
  error: Schema.TaggedStruct("FetchError", { status: Schema.Number }),
}) {}

// error stamp surfaces on manual `run` RPC when stamped (see daemon-run-rpc.test.ts)
void Daemon.errorOf(PricedErr);

// owns an inline schedule — gains the `schedule` verb group (id optional on windows)
class Matches extends Daemon.Tag<Matches>()("shape/Matches").pipe(
  Daemon.schedule([
    Daemon.window(startAt, stopAt),
    Daemon.window("sun-slate", startAt, stopAt),
    Daemon.at(startAt),
  ]),
) {}

// standalone schedule resource + a daemon gated by it (no schedule verbs on the daemon)
class SeasonSchedule extends Daemon.Schedule<SeasonSchedule>()("shape/SeasonSchedule") {}
class Ingest extends Daemon.Tag<Ingest>()("shape/Ingest").pipe(
  Daemon.schedule(SeasonSchedule),
) {}

const _proof = (Effect.gen(function* () {
  const h = yield* Health;
  // `status` is a reactive `ref`: `.get` reads it once, `.changes` streams it.
  const _status: typeof Daemon.daemonStatus.Type = yield* h.status.get;
  yield* h.start; // void lifecycle command
  yield* h.run;
  const _logExport = yield* Hyperlink.logs(Health);
  const _logHistory: ReadonlyArray<typeof Daemon.daemonLogEntry.Type> = yield* _logExport.query({});

  const p = yield* Prices;
  const latest: Option.Option<typeof Price.Type> = yield* p.result.get;

  const m = yield* Matches;
  const entries: ReadonlyArray<typeof Daemon.daemonScheduleEntry.Type> =
    yield* m.schedule.entries.get;
  yield* m.schedule.add(entries[0]!);
  yield* m.schedule.clear;

  const s = yield* SeasonSchedule;
  yield* s.add(entries[0]!);
  const one: Option.Option<typeof Daemon.daemonScheduleEntry.Type> = yield* s.get({ id: "x" });

  const i = yield* Ingest;
  yield* i.start;
  // @ts-expect-error a daemon gated by an external schedule gains NO schedule verbs
  yield* i.schedule.entries.get;

  const pe = yield* PricedErr;
  const _pricedRun: Effect.Effect<
    typeof Price.Type,
    { readonly _tag: "FetchError"; readonly status: number }
  > = pe.run;

  return { _status, _logHistory, latest, one, _pricedRun };
}) as any);

void _proof;

// The runtime layers pin the tag to the base spec; a composed tag (`+ result` / `+ schedule`) must
// still be accepted, and each grants its own `Self` so `yield* Tag` keeps the composed surface.
const _baseLocal = Daemon.layerMemory(Health, { effect: Effect.void });
const _resultServe = Daemon.serveMemory(Prices, {
  effect: Effect.succeed({ symbol: "AAPL", usd: 1 }),
});
const _scheduleServeRemote = Daemon.serveRemoteMemory(Matches, { effect: Effect.void }) as any;
const _scheduleResLocal = Daemon.scheduleLayer(SeasonSchedule);
const _scheduleResServe = Daemon.scheduleServe(SeasonSchedule, {
  initial: [Daemon.window("wk1", startAt, stopAt)],
});

void _baseLocal;
void _resultServe;
void _scheduleServeRemote;
void _scheduleResLocal;
void _scheduleResServe;
