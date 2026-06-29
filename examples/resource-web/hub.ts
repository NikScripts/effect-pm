/**
 * @module examples/resource-web/hub
 *
 * The review fixture for the shipped `@nikscripts/effect-pm/web` widgets — one of each **unique**
 * thing the dashboard renders, no duplicates: a nested group, a queue, and a scheduled process
 * (the WNBA live-score poller, armed only around game time). Local layers so it renders standalone;
 * swapping each for `Resource.client` + connect is how it points at a remote host.
 */
import { DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as QueueResource from "../../src/QueueContract";
import * as ProcessResource from "../../src/ScheduledProcess";
import * as Group from "../../src/Group";
import { Polling } from "../../src/Polling";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { ProcessStorage } from "../../src/ProcessStorage";

const importJob = Schema.Struct({ id: Schema.String });

// A queue (box-score imports) and a scheduled process (the live-score poller), under one league.
class BoxScoreQueue extends QueueResource.Tag<BoxScoreQueue>()("wnba/BoxScoreQueue", importJob) {}
class LiveScorePoller extends ProcessResource.Tag<LiveScorePoller>()("wnba/LiveScorePoller") {}

/** WNBA league group — a nested group the dashboard drills into. */
export class Wnba extends Group.Tag<Wnba>("hub/Wnba")({
  LiveScorePoller,
  BoxScoreQueue,
}) {}

/** The hub the dashboard renders. */
export class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Wnba,
}) {}

const importWorker = (job: { readonly id: string }) =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`importing ${job.id}`);
    yield* Effect.sleep(Duration.millis(400));
  });

// ── WNBA live-score poller: armed only around game time ──────────────────────
// In a real app you'd fetch the league schedule from a sports API; here we mock a few games and
// arm the poller from 20 min before each tip-off until 60 min after — so it only polls live scores
// while a game is on. The window entries show up (and are editable) in the dashboard's schedule.
const MIN = 60_000;
const HR = 60 * MIN;
// @effect-diagnostics-next-line globalDate:off
const baseNow = Date.now();
const toDate = (ms: number): Date => DateTime.toDateUtc(DateTime.makeUnsafe(ms));
const wnbaGames: ReadonlyArray<{ readonly id: string; readonly tipOff: number }> = [
  { id: "LV@NY", tipOff: baseNow - 10 * MIN }, // tipped off 10 min ago → live now
  { id: "SEA@CHI", tipOff: baseNow + 2 * HR }, // later today
  { id: "PHX@LA", tipOff: baseNow + 26 * HR }, // tomorrow
];
const pollerSchedule = ProcessSchedule.define(({ window, all }) =>
  all(...wnbaGames.map((g) => window(g.id, toDate(g.tipOff - 20 * MIN), toDate(g.tipOff + 60 * MIN)))),
);

const appLayer = Layer.mergeAll(
  QueueResource.layer(BoxScoreQueue, { effect: importWorker, concurrency: 3 }),
  ProcessResource.layer(LiveScorePoller, {
    effect: Effect.logInfo("wnba: polling live scores"),
    polling: Polling.spaced(Duration.seconds(2)),
    scheduleLayer: pollerSchedule,
  }),
).pipe(Layer.provide(ProcessStorage.layer));

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
