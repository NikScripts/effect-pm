/**
 * Type-level proof that the composed `Daemon` contract resolves in `extends … .pipe(...)`
 * position and surfaces the right service shape for each variant: base, value-returning
 * (`result`), inline-scheduled (gains the `schedule` verb group), and externally-gated
 * (gains no schedule verbs). Typecheck-only.
 */
import { Effect, Option, Schema } from "effect";
import * as Daemon from "../src/Daemon";
import * as Hyperlink from "../src/Hyperlink";
import * as Store from "../src/Store";

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

const HealthEffect: Effect.Effect<Effect.Success<typeof Health>, never, Health> = Health;
const PricesEffect: Effect.Effect<Effect.Success<typeof Prices>, never, Prices> = Prices;
const MatchesEffect: Effect.Effect<Effect.Success<typeof Matches>, never, Matches> = Matches;
const SeasonScheduleEffect: Effect.Effect<
  Effect.Success<typeof SeasonSchedule>,
  never,
  SeasonSchedule
> = SeasonSchedule;
const IngestEffect: Effect.Effect<Effect.Success<typeof Ingest>, never, Ingest> = Ingest;
const PricedErrEffect: Effect.Effect<Effect.Success<typeof PricedErr>, never, PricedErr> =
  PricedErr;

const _proof: Effect.Effect<
  object,
  never,
  | Health
  | Prices
  | Matches
  | SeasonSchedule
  | Ingest
  | PricedErr
  | Store.Storage
> = Effect.gen(function* () {
  const h = yield* HealthEffect;
  // `status` is a reactive `ref`: `.get` reads it once, `.changes` streams it.
  const _status: typeof Daemon.daemonStatus.Type = yield* h.status.get;
  yield* h.start; // void lifecycle command
  yield* h.run;
  const _logExport = yield* Hyperlink.logs(Health);
  const _logHistory: ReadonlyArray<typeof Daemon.daemonLogEntry.Type> = yield* _logExport.query({});

  const p = yield* PricesEffect;
  const latest: Option.Option<typeof Price.Type> = yield* p.result.get;

  const m = yield* MatchesEffect;
  const entries: ReadonlyArray<typeof Daemon.daemonScheduleEntry.Type> =
    yield* m.schedule.entries.get;
  yield* m.schedule.add(entries[0]!);
  yield* m.schedule.clear;

  const s = yield* SeasonScheduleEffect;
  yield* s.add(entries[0]!);
  const one: Option.Option<typeof Daemon.daemonScheduleEntry.Type> = yield* s.get({ id: "x" });

  const i = yield* IngestEffect;
  yield* i.start;

  const pe = yield* PricedErrEffect;
  const _pricedRun: Effect.Effect<
    typeof Price.Type,
    { readonly _tag: "FetchError"; readonly status: number }
  > = pe.run;

  return { _status, _logHistory, latest, one, _pricedRun };
});

void _proof;

// The runtime layers pin the tag to the base spec; a composed tag (`+ result` / `+ schedule`) must
// still be accepted, and each grants its own `Self` so `yield* Tag` keeps the composed surface.
const _baseLocal = Daemon.layerMemory(Health, { effect: Effect.void });
const _resultServe = Daemon.serveMemory(Prices, {
  effect: Effect.succeed({ symbol: "AAPL", usd: 1 }),
});
const _scheduleServeRemote = Daemon.serveRemoteMemory(Matches, { effect: Effect.void });
const _scheduleResLocal = Daemon.scheduleLayer(SeasonSchedule);
const _scheduleResServe = Daemon.scheduleServe(SeasonSchedule, {
  initial: [Daemon.window("wk1", startAt, stopAt)],
});

void _baseLocal;
void _resultServe;
void _scheduleServeRemote;
void _scheduleResLocal;
void _scheduleResServe;
