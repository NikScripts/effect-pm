/**
 * @module examples/resource-web/hub
 *
 * An example `ServicesHub`-shaped tree (the wow-sports shape: leagues of processes +
 * queues + a schedule, nested under one hub) built on the **real** `.Tag` toolkit —
 * the review fixture for the shipped `@nikscripts/effect-pm/web` widgets. Local
 * layers here so it renders standalone; swapping each for `Resource.client` + connect
 * is how it points at a remote host.
 */
import { DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import * as QueueResource from "../../src/QueueContract";
import * as ProcessResource from "../../src/ScheduledProcess";
import * as ProcessScheduleResource from "../../src/ProcessScheduleContract";
import * as Group from "../../src/Group";
import { Polling } from "../../src/Polling";
import { ProcessSchedule } from "../../src/ProcessSchedule";
import { ProcessStorage } from "../../src/ProcessStorage";

const importJob = Schema.Struct({ id: Schema.String });

// ── NWSL — two import queues + a season-matches process ──────────────────────
class RosterImportQueue extends QueueResource.Tag<RosterImportQueue>()("nwsl/RosterImportQueue", importJob) {}
class MediaImportQueue extends QueueResource.Tag<MediaImportQueue>()("nwsl/MediaImportQueue", importJob) {}
class SeasonMatches extends ProcessResource.Tag<SeasonMatches>()("nwsl/SeasonMatches") {}

// ── WNBA — a live-score poller + a cron schedule ─────────────────────────────
class LiveScorePoller extends ProcessResource.Tag<LiveScorePoller>()("wnba/LiveScorePoller") {}
class WnbaCron extends ProcessScheduleResource.Tag<WnbaCron>()("wnba/Cron") {}

/** NWSL league group. */
export class Nwsl extends Group.Tag<Nwsl>("hub/Nwsl")({
  RosterImportQueue,
  MediaImportQueue,
  SeasonMatches,
}) {}

/** WNBA league group. */
export class Wnba extends Group.Tag<Wnba>("hub/Wnba")({
  LiveScorePoller,
  Cron: WnbaCron,
}) {}

/** The hub the dashboard renders. */
export class ServicesHub extends Group.Tag<ServicesHub>("hub/ServicesHub")({
  Nwsl,
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
  QueueResource.layer(RosterImportQueue, { effect: importWorker, concurrency: 3 }),
  QueueResource.layer(MediaImportQueue, { effect: importWorker, concurrency: 2 }),
  ProcessResource.layer(SeasonMatches, {
    effect: Effect.logInfo("nwsl: polling season matches"),
    polling: Polling.spaced(Duration.seconds(3)),
  }),
  ProcessResource.layer(LiveScorePoller, {
    effect: Effect.logInfo("wnba: polling live scores"),
    polling: Polling.spaced(Duration.seconds(2)),
    scheduleLayer: pollerSchedule,
  }),
  ProcessScheduleResource.layer(WnbaCron, { initial: [] }),
).pipe(Layer.provide(ProcessStorage.layer));

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
