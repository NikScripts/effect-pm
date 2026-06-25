/**
 * @module examples/resource-web/hub
 *
 * An example `ServicesHub`-shaped tree (the wow-sports shape: leagues of processes +
 * queues + a schedule, nested under one hub) built on the **real** `.Tag` toolkit —
 * the review fixture for the shipped `@nikscripts/effect-pm/web` widgets. Local
 * layers here so it renders standalone; swapping each for `Resource.client` + connect
 * is how it points at a remote host.
 */
import { Duration, Effect, Layer, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { QueueResource } from "../../src/QueueContract";
import { ProcessResource } from "../../src/ProcessContract";
import { ProcessScheduleResource } from "../../src/ProcessScheduleContract";
import { Group } from "../../src/Group";
import { Polling } from "../../src/Polling";
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
  }),
  ProcessScheduleResource.layer(WnbaCron, { initial: [] }),
).pipe(Layer.provide(ProcessStorage.layer));

/** One reactive runtime providing every resource in the hub. */
export const runtime = Atom.runtime(appLayer);
